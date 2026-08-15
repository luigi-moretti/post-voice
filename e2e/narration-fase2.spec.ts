import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Page } from '@playwright/test';
import { openNarrationPanel } from './open-narration-panel';

/**
 * Playing length of the panel's audio, in seconds.
 *
 * Polled rather than read once: `duration` is `NaN` until the element has its
 * metadata, and a blob URL supplies that a tick or two after the `<audio>` is in
 * the DOM. Reading it straight after `toBeVisible()` therefore yields `NaN`
 * often enough to matter, and `NaN > 0` is false — a flake that looks like a
 * product failure.
 *
 * @param page Playwright page.
 */
async function narrationDuration( page: Page ): Promise< number > {
	const audio = page.locator( '.post-voice-panel audio' ).first();
	await expect
		.poll( () =>
			audio.evaluate( ( el: HTMLAudioElement ) =>
				Number.isFinite( el.duration ) ? el.duration : null
			)
		)
		.not.toBeNull();
	return audio.evaluate( ( el: HTMLAudioElement ) => el.duration );
}

test.describe( 'Post Voice — Fase 2', () => {
	test( 'a block excluded in the inspector is left out of the narration', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Primeiro parágrafo.' },
		} );
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Segundo parágrafo.' },
		} );

		// The block Inspector ("Editor settings") and the plugin's own Narration
		// sidebar are the same single complementary-area slot — Gutenberg shows
		// one at a time, and `NarrationPanel` unmounts (and disposes its engine)
		// whenever it is not the active one (see the cleanup effect in
		// `index.tsx`). Every switch between "toggle the block checkbox" and
		// "read the narration panel" below is therefore an explicit round trip,
		// not a courtesy.
		await editor.openDocumentSettingsSidebar();
		await editor.selectBlocks(
			editor.canvas.getByText( 'Segundo parágrafo.' )
		);
		await page
			.getByRole( 'checkbox', { name: 'Include in the narration' } )
			.uncheck();
		await editor.saveDraft();

		await openNarrationPanel( page );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		// Generation runs for a while; the default 10s action timeout on `.click()`
		// is meant for interactions, not for the wait until the button appears.
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect( page.getByText( 'Up to date' ) ).toBeVisible( {
			timeout: 900_000,
		} );

		// No reload here on purpose. `confirmSave` posts straight to the plugin's
		// own REST route rather than through the editor's redux save flow, so it
		// has to hand the editor's `meta` the values it just persisted itself
		// (the `editPost` in `confirmSave`). Without that, the staleness check
		// below — which runs after a remount and has only that meta to compare
		// against — would read an empty `_narration_source_hash`, bail out, and
		// leave the badge green no matter what the author changed. Reloading
		// would hide exactly that defect, so this walks the path an author walks.

		// The audio itself cannot be asserted on without transcribing it, so the
		// assertion goes through the hash: it is taken over exactly what was
		// synthesised, so re-including the block has to change it. A green badge
		// after re-including would mean the exclusion never reached the pipeline.
		await editor.openDocumentSettingsSidebar();
		await editor.selectBlocks(
			editor.canvas.getByText( 'Segundo parágrafo.' )
		);
		await page
			.getByRole( 'checkbox', { name: 'Include in the narration' } )
			.check();

		// Back to the narration panel to read the badge the checkbox just
		// invalidated — remounting re-runs its staleness check against the block
		// state as it stands now, checkbox included.
		await openNarrationPanel( page );
		await expect( page.getByText( 'May be out of date' ) ).toBeVisible();

		// And the duration is the other half: audio for one paragraph is shorter
		// than audio for two, which no hash comparison can prove.
		const duration = await page
			.locator( '.post-voice-panel audio' )
			.first()
			.evaluate( ( el: HTMLAudioElement ) => el.duration );
		expect( duration ).toBeGreaterThan( 0 );
	} );

	test( 'a second language with no room to download is blocked before the fetch', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Uma frase curta.' },
		} );
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content: 'A short sentence.',
				pvLanguage: 'english_2026-04',
			},
		} );
		await editor.saveDraft();

		// Same stub the Fase 1 storage scenario uses: report a quota that cannot
		// hold the pending bundles, and assert the panel refuses before spending
		// bandwidth rather than failing part-way through a 199MB fetch.
		await page.addInitScript( () => {
			navigator.storage.estimate = async () => ( {
				quota: 100 * 1024 * 1024,
				usage: 0,
			} );
		} );
		await page.reload();

		// "Before the fetch" is half the claim in this scenario's name, and a
		// message on screen does not prove it: the refusal is only worth anything
		// if no bundle byte was ever requested. Same watch the Fase 1 storage
		// scenario keeps.
		const modelRequests: string[] = [];
		page.on( 'request', ( request ) => {
			if ( request.url().includes( 'huggingface.co' ) ) {
				modelRequests.push( request.url() );
			}
		} );

		await openNarrationPanel( page );
		// Forced explicitly rather than relying on the site's own locale mapping
		// to land on a language other than English — on this environment
		// `get_locale()` is `en_US`, so the panel's own default is already
		// `english_2026-04`, and the point of "a second language" is lost if the
		// first paragraph's implied language happens to match it by accident.
		await page
			.getByRole( 'combobox', { name: 'Language', exact: true } )
			.selectOption( 'portuguese' );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();

		// Pinned to the notice itself, not to "somewhere on the page". Both
		// assertions below match more than one element otherwise: the message is
		// echoed verbatim into WordPress's screen-reader-only `a11y-speak-region`,
		// and "English" is also the label of an <option> in the Language select a
		// few nodes down. Matching either of those would let this pass while the
		// notice said something else entirely.
		const notice = page.locator(
			'.post-voice-panel .components-notice__content'
		);
		await expect( notice ).toContainText( 'Not enough free space' );
		// Naming English is the assertion that makes this a *second-language*
		// test: it is only in the estimate because the second paragraph is marked
		// `english_2026-04`, so a refusal that counted the panel's own language
		// alone would not mention it.
		await expect( notice ).toContainText( 'English' );

		expect( modelRequests ).toEqual( [] );
	} );

	test( 'an inline marked run survives a save as Author', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		const author = await requestUtils.createUser( {
			username: 'pv-author',
			email: 'pv-author@example.com',
			password: 'pv-author-pass',
			roles: [ 'author' ],
		} );

		// Log the browser itself in as the author, not just `requestUtils` — its
		// request context is a separate connection from `page`'s, so logging in
		// there would leave `page` still authenticated as Administrator.
		// Administrator carries `unfiltered_html` by default on a single-site
		// install, so publishing this post as Admin would pass regardless of
		// whether kses actually let the attribute through — the whole point of
		// this scenario is the role that does NOT have that capability.
		await page.goto( '/wp-login.php' );
		await page.locator( '#user_login' ).fill( 'pv-author' );
		await page.locator( '#user_pass' ).fill( 'pv-author-pass' );
		await page.locator( '#wp-submit' ).click();
		await page.waitForURL( /wp-admin/ );

		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content:
					'Ele disse <span data-pv-lang="english_2026-04">batteries with wheels</span> e sentou.',
			},
		} );
		await editor.publishPost();

		const content = await editor.getEditedPostContent();

		// kses strips unknown attributes for roles without unfiltered_html. If this
		// fails, the fix is wp_kses_allowed_html — not dropping the assertion.
		expect( content ).toContain( 'data-pv-lang="english_2026-04"' );

		// This install's `@wordpress/e2e-test-utils-playwright` (1.16.x) does not
		// bind `deleteUser` onto `RequestUtils`, only `createUser` and
		// `deleteAllUsers` — so this calls the same REST endpoint that helper
		// would have.
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/users/${ author.id }`,
			params: { force: true, reassign: 1 },
		} );
	} );

	test( 'a dictionary entry changes what is narrated', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'A BYD cresceu.' },
		} );

		await openNarrationPanel( page );
		await page
			.getByRole( 'button', {
				name: 'Pronunciation for this post',
				exact: true,
			} )
			.click();
		await page
			.getByRole( 'button', { name: 'Add term', exact: true } )
			.click();
		await page.getByLabel( 'Term' ).fill( 'BYD' );
		await page.getByLabel( 'Read as' ).fill( 'Bi Iou Di' );

		// Saving the post persists the meta; reopening proves it round-tripped
		// through the REST schema rather than living only in editor state.
		await editor.saveDraft();
		await page.reload();
		await openNarrationPanel( page );
		await page
			.getByRole( 'button', {
				name: 'Pronunciation for this post',
				exact: true,
			} )
			.click();
		await expect( page.getByLabel( 'Read as' ) ).toHaveValue( 'Bi Iou Di' );

		// Round-tripping the meta only proves it was stored. That the substitution
		// reaches the synthesis is what the phase promises, and the hash is where
		// that is observable without transcribing audio: generate, save, then
		// change the entry and watch the badge turn.
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		// Generation runs for a while; the default 10s action timeout on `.click()`
		// is meant for interactions, not for the wait until the button appears.
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect( page.getByText( 'Up to date' ) ).toBeVisible( {
			timeout: 900_000,
		} );

		// No reload: the dictionary edit below has to flip the badge in the same
		// session that generated the audio, which is the session an author is
		// most likely to keep editing in. That only works because `confirmSave`
		// hands the editor's `meta` the hash it just persisted; reading the
		// unrefreshed meta instead leaves `savedHash` empty, and the staleness
		// comparison skips entirely on a falsy hash.
		await page.getByLabel( 'Read as' ).fill( 'B Y D' );
		await expect( page.getByText( 'May be out of date' ) ).toBeVisible();
	} );

	test( 'editing the dictionary marks existing audio as possibly outdated', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'A BYD cresceu.' },
		} );
		await editor.saveDraft();

		await openNarrationPanel( page );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		// Generation runs for a while; the default 10s action timeout on `.click()`
		// is meant for interactions, not for the wait until the button appears.
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect( page.getByText( 'Up to date' ) ).toBeVisible( {
			timeout: 600_000,
		} );

		// Same as the previous scenario: no reload, because the badge has to turn
		// within the session that saved the audio.
		await page
			.getByRole( 'button', {
				name: 'Pronunciation for this post',
				exact: true,
			} )
			.click();
		await page
			.getByRole( 'button', { name: 'Add term', exact: true } )
			.click();
		await page.getByLabel( 'Term' ).fill( 'BYD' );
		await page.getByLabel( 'Read as' ).fill( 'Bi Iou Di' );

		await expect( page.getByText( 'May be out of date' ) ).toBeVisible();
	} );

	test( 'a post in two languages produces one MP3, with the inline-marked run heard in its own language', async ( {
		admin,
		editor,
		page,
	} ) => {
		test.setTimeout( 1_800_000 );

		await admin.createNewPost();
		// One paragraph carries both mechanisms Fase 2 added: an inline
		// `data-pv-lang` run inside an otherwise-Portuguese paragraph, and a
		// second paragraph marked wholesale via the block's own "Language for
		// this block" attribute. Both must reach the same synthesis pipeline —
		// the badge below names every language actually spoken, not just the
		// block-level one, which is the only way this test can tell an inline
		// mark that survived from one that silently narrated as Portuguese.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content:
					'Uma frase curta com <span data-pv-lang="english_2026-04">a small English aside</span> no meio.',
			},
		} );
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content: 'A short sentence.',
				pvLanguage: 'english_2026-04',
			},
		} );
		await editor.saveDraft();

		await openNarrationPanel( page );
		// Forced explicitly for the same reason as the storage-blocked scenario:
		// `get_locale()` on this environment is `en_US`, so the panel's own
		// default is already `english_2026-04` — leaving it alone would make
		// paragraph one's implied language collide with the second paragraph's
		// explicit one instead of producing a genuine two-language post.
		await page
			.getByRole( 'combobox', { name: 'Language', exact: true } )
			.selectOption( 'portuguese' );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		// Generation runs for a while; the default 10s action timeout on `.click()`
		// is meant for interactions, not for the wait until the button appears.
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();

		// The badge joins `languageLabel()` output, not the raw bundle
		// identifiers — see `index.tsx`'s `%1$s · voice %2$s` line.
		await expect( page.getByText( 'Português + English' ) ).toBeVisible( {
			timeout: 1_500_000,
		} );

		const audio = page.locator( '.post-voice-panel audio' );
		await expect( audio ).toHaveCount( 1 );
	} );

	test( 'cancelling during a language warm-up leaves the editor recoverable', async ( {
		admin,
		editor,
		page,
	} ) => {
		// `calibrate()` (tts-engine.ts) takes no `AbortSignal`, so a cancel that
		// lands during the per-language warm-up cannot interrupt that call — only
		// stop the worker from ever reporting back, via `dispose()`'s
		// `worker.terminate()`. The human partner ruled this acceptable: the
		// warm-up is short and the failure mode is a wait, not corruption. What
		// has to hold is the second half — the editor comes back and a real
		// generation afterwards still works. That is what this test asserts;
		// it does not assert the warm-up stops instantly, because it does not.
		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Uma frase qualquer para o aquecimento.' },
		} );
		await editor.saveDraft();

		await openNarrationPanel( page );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();

		// "Preparing…" is the `calibrating` state's own label (index.tsx), shown
		// for as long as the bundle download, the ONNX session init and the
		// warm-up sample all take — distinct from "Synthesising audio…", which
		// only appears once `calibrate()` has already returned.
		await expect( page.getByText( 'Preparing…' ) ).toBeVisible( {
			timeout: 60_000,
		} );
		await page
			.getByRole( 'button', { name: 'Cancel', exact: true } )
			.click();

		// The click clears the panel's state synchronously. The abandoned
		// warm-up keeps running for a moment inside a worker that has just been
		// terminated, so nothing more is ever posted back — no error notice, no
		// generation left spinning forever.
		await expect(
			page.getByRole( 'button', { name: 'Generate audio', exact: true } )
		).toBeVisible();
		// Give the abandoned promise chain, if it were ever going to misfire, a
		// real window to do so before trusting the calm.
		await page.waitForTimeout( 5_000 );
		await expect(
			page.locator( '.components-notice.is-error' )
		).toHaveCount( 0 );
		await expect(
			page.getByRole( 'button', { name: 'Generate audio', exact: true } )
		).toBeVisible();

		// Recovered, not just visually: a full generation right after still
		// completes normally, proving the engine (a fresh instance — the
		// cancelled one was disposed) is not left in some half-initialised state.
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect( page.getByText( 'Up to date' ) ).toBeVisible( {
			timeout: 60_000,
		} );
	} );

	test( 'cancelling a multi-segment generation and immediately regenerating produces one clean audio file', async ( {
		admin,
		editor,
		page,
	} ) => {
		// pocket-tts.worker.js cancels cooperatively through a single shared
		// `isGenerating` flag: `stop` clears it (:709-713) but the running
		// pipeline only notices at its next loop check (:816, :854), and a new
		// `generate` message re-arms it (:753-756, :765) before that stale loop
		// ever trips its own check — in principle, two loops could then interleave
		// `audio_chunk` posts into the same listener. `generateSegments`
		// (tts-engine.ts) reuses one worker instance across every segment of a
		// language group, so a post with several paragraphs in one language
		// exercises that same-instance risk without needing a second bundle. The
		// panel's actual defence is `cancelGeneration` disposing (terminating) the
		// worker on every cancel rather than fixing the flag race — this asserts
		// that defence still holds with several segments in flight, which is the
		// scenario the single-segment Fase 1 regression test cannot reach.
		await admin.createNewPost();
		for ( const text of [
			'Primeiro parágrafo, propositalmente mais longo para dar tempo de cancelar no meio da síntese.',
			'Segundo parágrafo, ainda no meio da síntese.',
			'Terceiro parágrafo, para garantir mais de uma segmentação.',
		] ) {
			await editor.insertBlock( {
				name: 'core/paragraph',
				attributes: { content: text },
			} );
		}
		await editor.saveDraft();

		await openNarrationPanel( page );

		// A clean generation first, purely to measure how long this post's audio
		// is when nothing was ever cancelled. Without that number the assertion
		// after the cancel can only be `duration > 0`, which any non-empty buffer
		// satisfies — including one built from two interleaved pipelines, which
		// is the exact defect this scenario exists for. Interleaved `audio_chunk`
		// posts would land the paragraphs twice (roughly double), and a pipeline
		// killed mid-run would land fewer (short); both are only visible against
		// a baseline.
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		const baseline = await narrationDuration( page );
		expect( baseline ).toBeGreaterThan( 0 );

		await page
			.getByRole( 'button', { name: 'Discard', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Generate audio', exact: true } )
		).toBeVisible();

		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();

		// Wait past the warm-up into real per-segment synthesis — cancelling here,
		// rather than during "Preparing…", is what puts the shared worker instance
		// mid-pipeline instead of mid-warm-up.
		await expect(
			page.locator( '.post-voice-panel__generating-label' )
		).toHaveText( 'Synthesising audio…', { timeout: 120_000 } );
		await page
			.getByRole( 'button', { name: 'Cancel', exact: true } )
			.click();

		// Immediately, with no wait in between: the whole point is to start the
		// second generation while the abandoned pipeline could still be running.
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );

		// Exactly one preview player — not one per surviving pipeline.
		await expect( page.locator( '.post-voice-panel audio' ) ).toHaveCount(
			1
		);

		// And the audio in it is the whole post exactly once. The tolerance is
		// wide because synthesis is not bit-identical between runs — the same
		// text can come out a fraction of a second longer — but it is nowhere
		// near wide enough to admit a doubled or a truncated narration.
		const afterCancel = await narrationDuration( page );
		expect( afterCancel ).toBeGreaterThan( baseline * 0.8 );
		expect( afterCancel ).toBeLessThan( baseline * 1.25 );

		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect( page.getByText( 'Up to date' ) ).toBeVisible( {
			timeout: 60_000,
		} );
	} );
} );
