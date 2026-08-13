import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Admin, Editor } from '@wordpress/e2e-test-utils-playwright';

// Short on purpose: every second of synthesised audio is a second of test runtime.
const NARRATION_TEXT = 'Hello world, this is a test post.';

/**
 * Open a saved draft containing one narratable paragraph.
 *
 * Two things createNewPost() does not do, both of which the panel cares about.
 * It passes `content` as a query argument, and WordPress parses raw text with no
 * block delimiters into a `core/freeform` (classic) block — not in the narratable
 * block list, so extraction returns an empty string and the panel reports "No
 * readable text found". And it leaves the post at status `auto-draft`, where the
 * panel deliberately disables generation (and the REST endpoint answers 409), so
 * the Generate button never becomes clickable.
 *
 * @param admin  Admin fixture.
 * @param editor Editor fixture.
 * @param title  Title for the created post.
 */
async function createNarratableDraft(
	admin: Admin,
	editor: Editor,
	title: string
) {
	await admin.createNewPost( { title } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content: NARRATION_TEXT },
	} );
	await editor.saveDraft();
}

test.describe( 'Post Voice — narration generation', () => {
	test( 'author generates, previews, and saves narration end to end', async ( {
		admin,
		editor,
		page,
	} ) => {
		await createNarratableDraft( admin, editor, 'Narration happy path' );
		await editor.openDocumentSettingsSidebar();
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 120_000 } );
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible();

		await editor.publishPost();

		// Read the post ID from the editor store rather than scraping a permalink
		// out of the post-publish panel — that panel's markup is WordPress's to
		// change, and `a.components-external-link` no longer matches anything in
		// it as of 6.6.
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
		await page.goto( `/?p=${ postId }` );
		await expect( page.locator( '.post-voice-player audio' ) ).toHaveCount(
			1
		);
	} );

	test( 'regenerating replaces the previous attachment without leaving an orphan', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await createNarratableDraft( admin, editor, 'Regenerate test' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click( { timeout: 120_000 } );
		// Counting only once the panel is back to its saved state: the deletion of
		// the superseded attachment happens inside the request this button is
		// waiting on, and counting mid-flight sees both files and fails at random.
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

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
		// Scoped to this post, and unpaginated: the shared media listing defaults
		// to ten items, so counting it globally measures other tests as much as
		// this one.
		const attachmentsFor = () =>
			requestUtils.rest( {
				path: '/wp/v2/media',
				params: { parent: postId, per_page: 100 },
			} );

		expect( await attachmentsFor() ).toHaveLength( 1 );

		await page
			.getByRole( 'button', { name: 'Generate again', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click( { timeout: 120_000 } );
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		expect( await attachmentsFor() ).toHaveLength( 1 );
	} );

	test( 'audio generated before a text edit is marked out of date once saved', async ( {
		admin,
		editor,
		page,
	} ) => {
		// The hash recorded on save must describe the text the audio was actually
		// synthesised from. Hashing the editor's current text instead let an author
		// edit while generation ran and get audio labelled "Up to date" that did not
		// match a word of the post.
		await createNarratableDraft( admin, editor, 'Stale after edit' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		// Edit after generating, before saving.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: {
				content: 'An extra paragraph the audio never covered.',
			},
		} );

		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();

		await expect(
			page.locator( '.post-voice-panel__badge' )
		).toContainText( /out of date/i );
	} );

	test( 'the voice model downloads once per browser, not once per session', async ( {
		admin,
		editor,
		page,
	} ) => {
		// Hugging Face serves model files with no Cache-Control at all, so the HTTP
		// cache re-fetched roughly 190MB every time an author opened a post. The
		// worker now stores them in the Cache API; this proves a second session
		// touches the network for none of them.
		await createNarratableDraft( admin, editor, 'Model cache' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		// A reload is a new session: new worker, new ONNX sessions, same origin
		// storage.
		const modelRequests: string[] = [];
		page.on( 'request', ( request ) => {
			if ( request.url().includes( 'huggingface.co' ) ) {
				modelRequests.push( request.url() );
			}
		} );

		await page.reload();
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		expect( modelRequests ).toEqual( [] );
	} );

	test( 'an unwanted preview can be discarded instead of forced onto the post', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		// The preview state used to offer "Save narration" and nothing else, so an
		// author who disliked the result had no way out but to persist it.
		await createNarratableDraft( admin, editor, 'Discard preview' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		// Regenerating without saving is also possible, per the spec.
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible();

		const mediaBefore = await requestUtils.rest( { path: '/wp/v2/media' } );

		await page
			.getByRole( 'button', { name: 'Discard', exact: true } )
			.click();

		// Back to the pre-generation state, and nothing reached the Media Library.
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeHidden();
		await expect(
			page.getByRole( 'button', { name: 'Generate audio', exact: true } )
		).toBeVisible();

		const mediaAfter = await requestUtils.rest( { path: '/wp/v2/media' } );
		expect( mediaAfter.length ).toBe( mediaBefore.length );
	} );

	test( 'the chosen voice is previewable and travels with the saved narration', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		await createNarratableDraft( admin, editor, 'Voice selection' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();

		await page
			.getByRole( 'combobox', { name: 'Voice', exact: true } )
			.selectOption( 'javert' );

		// The sample plays the bundle's own short phrase. It must not produce a
		// preview to save, and must not touch the Media Library — it is a way to
		// hear a voice, not a way to narrate the post.
		const mediaBeforeSample = await requestUtils.rest( {
			path: '/wp/v2/media',
		} );
		await page
			.getByRole( 'button', { name: /Hear a sample of javert/ } )
			.click();
		await expect(
			page.getByRole( 'button', { name: /Hear a sample of javert/ } )
		).toBeEnabled( { timeout: 120_000 } );
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeHidden();
		expect(
			( await requestUtils.rest( { path: '/wp/v2/media' } ) ).length
		).toBe( mediaBeforeSample.length );

		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click( { timeout: 120_000 } );
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible();

		// The voice is recorded alongside the audio, so reopening the post shows
		// what was actually generated rather than the default.
		const postId = await page.evaluate( () =>
			( window as any ).wp.data.select( 'core/editor' ).getCurrentPostId()
		);
		const post = await requestUtils.rest( {
			path: `/wp/v2/posts/${ postId }`,
		} );
		expect( post.meta._narration_voice ).toBe( 'javert' );
	} );

	test( 'a regenerated narration gets its own URL, so the player cannot serve the old audio', async ( {
		admin,
		editor,
		page,
	} ) => {
		// Reported from manual testing: after saving a new narration the panel kept
		// playing the previous one. Deleting the superseded attachment freed its
		// filename, so the next upload was handed the same name and the same URL —
		// and an `<audio>` element whose `src` string did not change never reloads.
		await createNarratableDraft( admin, editor, 'Fresh URL per narration' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();

		const saveOnce = async () => {
			await page
				.getByRole( 'button', {
					name: /^Generate (audio|again)$/,
					exact: true,
				} )
				.click();
			await page
				.getByRole( 'button', { name: 'Save narration', exact: true } )
				.click( { timeout: 120_000 } );
			await expect(
				page.getByRole( 'button', {
					name: 'Generate again',
					exact: true,
				} )
			).toBeVisible( { timeout: 120_000 } );
			return page
				.locator(
					'.post-voice-panel__card .post-voice-mini-player audio'
				)
				.getAttribute( 'src' );
		};

		const first = await saveOnce();
		const second = await saveOnce();
		// A third one matters: only here does WordPress hand back the filename the
		// first narration freed.
		const third = await saveOnce();

		expect( new Set( [ first, second, third ] ).size ).toBe( 3 );
	} );

	test( 'a double-click on Save leaves one audio file, not two', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		// Reported from manual testing: saving sometimes produced two audio files
		// for one post, and the player picked the older one. Both clicks land in
		// the same JavaScript task, so React has not yet unmounted the button and
		// both handlers ran; each request then read the attachment meta before the
		// other wrote it, so neither deleted the other's upload.
		await createNarratableDraft( admin, editor, 'Double save' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		const postId = await page.evaluate( () =>
			( window as any ).wp.data.select( 'core/editor' ).getCurrentPostId()
		);

		await page.evaluate( () => {
			const button = Array.from(
				document.querySelectorAll( 'button' )
			).find(
				( candidate ) =>
					candidate.textContent?.trim() === 'Save narration'
			) as HTMLButtonElement;
			button.click();
			button.click();
		} );

		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible( { timeout: 120_000 } );

		const attachments = await requestUtils.rest( {
			path: '/wp/v2/media',
			params: { parent: postId, per_page: 100 },
		} );
		expect( attachments ).toHaveLength( 1 );

		// And the post points at the file that survived, so the player cannot end
		// up on an older recording.
		const post = await requestUtils.rest( {
			path: `/wp/v2/posts/${ postId }`,
		} );
		expect( post.meta._narration_attachment_id ).toBe(
			attachments[ 0 ].id
		);
	} );

	test( 'author can cancel generation mid-flight', async ( {
		admin,
		editor,
		page,
	} ) => {
		await createNarratableDraft( admin, editor, 'Cancel test' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Cancel', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Generate audio', exact: true } )
		).toBeVisible();
	} );

	test( 'cancelling and immediately regenerating produces one clean audio file', async ( {
		admin,
		editor,
		page,
	} ) => {
		// Regression guard for a worker-level race: the vendored worker cancels via a
		// single shared `isGenerating` flag, so a regeneration started before the
		// cancelled pipeline noticed the flag used to leave two pipelines streaming
		// chunks into the same listener. The panel now disposes the worker on cancel.
		await createNarratableDraft( admin, editor, 'Cancel then regenerate' );
		await page
			.getByRole( 'button', { name: 'Narration', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await page
			.getByRole( 'button', { name: 'Cancel', exact: true } )
			.click();
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
	} );
} );
