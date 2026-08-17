import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Page } from '@playwright/test';
import { openNarrationPanel } from './open-narration-panel';
// The sample phrase is imported rather than copied: it is what `calibrate()`
// speaks, and a copy that drifted would leave the warm-up count below matching
// nothing and passing vacuously.
import { sampleTextFor } from '../features/narration/editor/voice-catalog';

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

		// Saving a narration must not leave the post looking edited. The panel
		// pushes what it persisted into the editor's cache through
		// `receiveEntityRecords`, which updates the *persisted* record; doing the
		// same with `editPost` would record an unsaved edit and greet the author
		// with a "Leave site?" prompt straight after a successful save. The
		// editor's own "Saved" button is disabled exactly while the post is not
		// dirty, which makes it the observable form of that claim.
		await expect(
			page.getByRole( 'button', { name: 'Saved' } )
		).toBeDisabled();

		// No reload here on purpose. `confirmSave` posts straight to the plugin's
		// own REST route rather than through the editor's redux save flow, so it
		// has to hand the editor's cached meta the values it just persisted.
		// Without that, the staleness check below — which runs after a remount
		// and has only that meta to compare against — would read an empty
		// `_narration_source_hash`, bail out, and leave the badge green no matter
		// what the author changed. Reloading would hide exactly that defect, so
		// this walks the path an author walks.

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

		// The discriminating assertion is the badge above; this one only pins that
		// what was saved is real, playable audio rather than an empty buffer that
		// happened to hash. (It deliberately does not claim "one paragraph is
		// shorter than two" — nothing here compares the two, and a comparison
		// would need a second full generation for a baseline, which the hash
		// already covers more cheaply.) Polled, because `duration` is `NaN` until
		// the element has its metadata, and this `<audio>` has just remounted
		// with an HTTP attachment URL rather than a blob.
		expect( await narrationDuration( page ) ).toBeGreaterThan( 0 );
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
		await requestUtils.createUser( {
			username: 'pv-author',
			email: 'pv-author@example.com',
			password: 'pv-author-pass',
			roles: [ 'author' ],
		} );

		try {
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

			const postId = await page.evaluate( () =>
				(
					window as unknown as {
						wp: {
							data: {
								select: ( s: string ) => {
									getCurrentPostId: () => number;
								};
							};
						};
					}
				 ).wp.data
					.select( 'core/editor' )
					.getCurrentPostId()
			);

			// Read the post back from the server, not from the editor.
			//
			// `editor.getEditedPostContent()` returns the *client's* serialized
			// blocks — `getEditedEntityRecord(...).content( record )` — and the
			// editor keeps those edits after a save. kses runs on the way in, on the
			// server, so asserting on the client copy can never observe it: this
			// scenario would stay green even if a filter stripped every `data-*`
			// attribute from what was actually stored. `content.raw` under
			// `context: 'edit'` is the stored post.
			const saved = ( await requestUtils.rest( {
				path: `/wp/v2/posts/${ postId }`,
				params: { context: 'edit' },
			} ) ) as { content: { raw: string } };

			// WordPress has allowed `data-*` on every element globally since 5.0
			// (`_wp_add_global_attributes`, wp-includes/kses.php), so an Author
			// without `unfiltered_html` keeps this attribute and no plugin-side
			// filter is needed. What this pins is that it stays that way: if a
			// future `wp_kses_allowed_html` filter or a core change drops `data-*`,
			// every marked run in every author-published post silently loses its
			// language and the narration reads it in the wrong voice. The fix would
			// then be to allow the attribute explicitly — not to drop this.
			expect( saved.content.raw ).toContain(
				'data-pv-lang="english_2026-04"'
			);
		} finally {
			// In a `finally` because a failure above must not leave `pv-author`
			// behind: `createUser` throws `existing_user_login` on the next run, so
			// one red assertion would turn into a different, unrelated red error on
			// both CI retries and every later run, hiding the original cause.
			// `deleteAllUsers` rather than `deleteUser`, which this install's
			// `@wordpress/e2e-test-utils-playwright` (1.16.x) does not bind onto
			// `RequestUtils`.
			await requestUtils.deleteAllUsers();
		}
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

		// A dictionary entry added but never saved to the post, on purpose, so the
		// narration below is generated while an unsaved meta edit is in flight.
		// That is the case a received record alone cannot fix: `getEditedEntityRecord`
		// is a shallow `{ ...raw, ...edits }`, and a meta edit carries a whole
		// snapshot of the meta as it stood when it was made — which shadows the
		// values the save is about to receive. Half-typing a term and then hitting
		// Generate is an ordinary thing to do, and without the fold-into-edits half
		// of `syncPersistedMeta` the badge below never turns.
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

		// No reload, because the badge has to turn within the session that saved
		// the audio. Changing the entry changes what would be synthesised, so the
		// hash the save recorded no longer describes the post.
		await page.getByLabel( 'Read as' ).fill( 'Bi Uai Di' );

		await expect( page.getByText( 'May be out of date' ) ).toBeVisible();
	} );

	test( 'the pronunciation panel opens on a browser without crypto.randomUUID', async ( {
		admin,
		editor,
		page,
	} ) => {
		// `Crypto.randomUUID` is secure-context-only, and a plain-HTTP editor is
		// a state this plugin supports on purpose: `ensureEngine` detects it and
		// answers with a sentence instead of failing obscurely. wp-env serves the
		// editor on localhost, which *is* a secure context, so that browser
		// cannot be reproduced by changing the URL. Taking away exactly the one
		// API that is missing there — and nothing else, `crypto.getRandomValues`
		// very much included, since the editor itself uses it — is the honest
		// stand-in.
		// `undefined`, not a function that throws: on a real insecure origin the
		// property is absent, and the difference decides the test. WordPress mints
		// every block's clientId through the bundled `uuid` v4, which reads
		// `if ( native.randomUUID && … ) return native.randomUUID()` — absent falls
		// back to `getRandomValues`, which is the path this scenario wants, while a
		// throwing stub passes that guard and kills `createBlock` before the plugin
		// is ever reached.
		await page.addInitScript( () => {
			Object.defineProperty( crypto, 'randomUUID', {
				configurable: true,
				value: undefined,
			} );
		} );

		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Uma frase qualquer.' },
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
		await editor.saveDraft();

		// The reload is the scenario, not a courtesy. The failure was in the
		// panel's state initialiser, so it needed a post that *already* has an
		// entry when the panel first mounts — a fresh mount over saved meta, which
		// is what an author gets every time they open a post they have already
		// added a term to. Before the fix this threw during render and the whole
		// sidebar was replaced by Gutenberg's generic error boundary.
		await page.reload();
		await openNarrationPanel( page );
		await page
			.getByRole( 'button', {
				name: 'Pronunciation for this post',
				exact: true,
			} )
			.click();
		await expect( page.getByLabel( 'Read as' ) ).toHaveValue( 'Bi Iou Di' );

		// Still a working panel rather than a rendered corpse: adding and removing
		// a row exercises both mutation handlers, which generated an id each.
		await page
			.getByRole( 'button', { name: 'Add term', exact: true } )
			.click();
		await expect( page.getByLabel( 'Term' ) ).toHaveCount( 2 );
		await page
			.getByRole( 'button', { name: 'Remove', exact: true } )
			.last()
			.click();
		await expect( page.getByLabel( 'Term' ) ).toHaveValue( 'BYD' );
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

	test( 'a generation warms each bundle up once, not once per code path', async ( {
		admin,
		editor,
		page,
	} ) => {
		test.setTimeout( 900_000 );

		// Warm-ups are only observable from outside through the messages the
		// panel posts to the worker: `calibrate()` synthesises the loaded
		// bundle's own sample phrase (`SAMPLE_TEXTS` in `voice-catalog.ts`), so a
		// `generate` message carrying exactly that text *is* a warm-up, and every
		// other one is a piece of the post. Nothing is stubbed here — the wrapper
		// records and forwards, and the generation below is a real one, with a
		// real bundle and real inference.
		//
		// Installed before the first navigation so it is in place for every page
		// this test loads.
		await page.addInitScript( () => {
			const texts: string[] = [];
			(
				window as unknown as { __postVoiceGenerateTexts: string[] }
			 ).__postVoiceGenerateTexts = texts;
			const original = Worker.prototype.postMessage;
			Worker.prototype.postMessage = function (
				this: Worker,
				message: unknown,
				...rest: unknown[]
			) {
				const payload = message as {
					type?: string;
					data?: { text?: string };
				};
				if ( payload && payload.type === 'generate' ) {
					texts.push( payload.data?.text ?? '' );
				}
				return ( original as ( ...args: unknown[] ) => void ).apply(
					this,
					[ message, ...rest ]
				);
			} as typeof Worker.prototype.postMessage;
		} );

		await admin.createNewPost();
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: 'Uma frase curta, num idioma só.' },
		} );
		await editor.saveDraft();

		await openNarrationPanel( page );
		// Forced rather than inherited from the locale, for the same reason as
		// the scenarios above: `get_locale()` is `en_US` here, and this scenario
		// has to know which bundle's sample phrase to count.
		await page
			.getByRole( 'combobox', { name: 'Language', exact: true } )
			.selectOption( 'portuguese' );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );

		const texts = await page.evaluate(
			() =>
				(
					window as unknown as {
						__postVoiceGenerateTexts: string[];
					}
				 ).__postVoiceGenerateTexts
		);
		const samplePhrase = sampleTextFor( 'portuguese' );
		const warmUps = texts.filter( ( text ) => text === samplePhrase );

		// One. `startGeneration` calibrates the bundle itself (it keeps the audio
		// for the sample cache) and `generateSegments` used to calibrate every
		// group again unconditionally, so this post — one paragraph, one language,
		// the common case — paid for two full sample-phrase syntheses on every
		// click of Generate, the second one measuring a number the engine already
		// had. Several seconds of dead time behind a panel already reading
		// "Synthesising audio…".
		expect( warmUps ).toHaveLength( 1 );
		// And the post itself was synthesised, so the count above is one warm-up
		// out of a real generation rather than a generation that never happened.
		expect( texts.length ).toBeGreaterThan( warmUps.length );
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
	test( 'typing does not re-run the segment parser once per keystroke', async ( {
		admin,
		editor,
		page,
	} ) => {
		// The guard this scenario protects is the spec's first performance guard:
		// the segment pipeline runs once per 300ms debounce, not once per
		// character. It was silently bypassed for a while — the segment count and
		// the unrecognised-language notice were `useMemo`s keyed on values that
		// change on every keystroke (`blocks` is a fresh array out of
		// `getBlocks()` every time), so each character paid two full `DOMParser`
		// passes plus a dictionary pass *in render*, on top of the debounced one.
		//
		// `e2e/segment-pipeline-perf.spec.ts` cannot see this: it times the
		// pipeline in isolation, so it measures one call and says nothing about
		// how many calls the editor makes. This counts the calls instead.
		//
		// The instrument is `DOMParser.prototype.parseFromString`, filtered on the
		// `<body>` wrapper that `segmentsFromHtml` — and, in this editor, only
		// `segmentsFromHtml` — puts in front of the markup it parses. Gutenberg
		// and its own dependencies parse plenty of HTML while the editor runs;
		// none of it carries that prefix.
		await page.addInitScript( () => {
			window.__postVoiceExtractorParses = 0;
			const parse = DOMParser.prototype.parseFromString;
			DOMParser.prototype.parseFromString = function (
				this: DOMParser,
				markup: string,
				type: DOMParserSupportedType
			): Document {
				if (
					typeof markup === 'string' &&
					markup.startsWith( '<body>' )
				) {
					window.__postVoiceExtractorParses =
						( window.__postVoiceExtractorParses ?? 0 ) + 1;
				}
				return parse.call( this, markup, type );
			};
		} );

		await admin.createNewPost();
		// An explicit empty paragraph rather than the canvas's default appender:
		// the appender is a placeholder, not a block, so there is nothing to click
		// into and nothing for `getBlocks()` to hand the panel.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: '' },
		} );
		await openNarrationPanel( page );

		// An empty post first, for the other half of the change: the count is
		// debounced now, so the panel has to seed it synchronously on mount or it
		// would spend the first 300ms of every open claiming there is nothing to
		// narrate. Here there genuinely is nothing, and the hint has to be up
		// immediately rather than 300ms late — and, more to the point, it has to
		// be a real signal, so that its disappearance below proves the deferred
		// pass actually landed.
		const nothingToNarrate = page.getByText( 'Nothing to narrate yet' );
		await expect( nothingToNarrate ).toBeVisible();

		await editor.canvas
			.locator( '[data-type="core/paragraph"]' )
			.first()
			.click();
		await expect( page.locator( '.post-voice-panel' ) ).toBeVisible();

		// Zeroed after the panel has mounted and settled, so the count below is
		// keystrokes and nothing else.
		await page.evaluate( () => {
			window.__postVoiceExtractorParses = 0;
		} );

		// 20ms apart: comfortably inside the 300ms window, so the whole burst
		// collapses into a single debounced pass. This is what an author typing a
		// sentence produces.
		const typed = 'A BYD terminou o trimestre a frente de todas.';
		await page.keyboard.type( typed, { delay: 20 } );

		// The pass landed: the hint is gone, which only the debounced recount can
		// do. Without this the parse count below could pass by the pipeline never
		// running at all.
		await expect( nothingToNarrate ).toBeHidden();
		await expect(
			editor.canvas.getByText( typed, { exact: true } )
		).toBeVisible();

		const parses = await page.evaluate(
			() => window.__postVoiceExtractorParses ?? 0
		);

		// The number itself, not only the verdict: a future recalibration needs to
		// know how much headroom the ceiling below actually has.
		// eslint-disable-next-line no-console
		console.log(
			`extractor parses for ${ typed.length } keystrokes: ${ parses }`
		);

		// Measured on this machine, three runs each: 1 with the debounce
		// respected — the single post-burst pass over the post's one paragraph —
		// and 90 against the code as it stood at `cd14257`, which is exactly
		// 2 x 45, the two render-path parses per character this scenario exists
		// to catch. The ceiling sits far above the former and far below the
		// latter, so a slower runner splitting the burst into two or three
		// debounced passes stays green while any return of a per-keystroke parse
		// fails.
		expect( parses ).toBeLessThanOrEqual( 8 );
		expect( parses ).toBeGreaterThan( 0 );
	} );
} );

declare global {
	interface Window {
		/**
		 * Extractor `DOMParser` calls counted by the scenario above. Installed by
		 * that test's own init script and by nothing else — the plugin never reads
		 * or writes it.
		 */
		__postVoiceExtractorParses?: number;
	}
}
