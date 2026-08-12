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
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration' } )
		).toBeVisible( { timeout: 120_000 } );
		await page.getByRole( 'button', { name: 'Save narration' } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Generate again' } )
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
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await page
			.getByRole( 'button', { name: 'Save narration' } )
			.click( { timeout: 120_000 } );

		const mediaBefore = await requestUtils.rest( { path: '/wp/v2/media' } );

		await page.getByRole( 'button', { name: 'Generate again' } ).click();
		await page
			.getByRole( 'button', { name: 'Save narration' } )
			.click( { timeout: 120_000 } );

		const mediaAfter = await requestUtils.rest( { path: '/wp/v2/media' } );
		expect( mediaAfter.length ).toBe( mediaBefore.length );
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
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await page.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Generate audio' } )
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
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await page.getByRole( 'button', { name: 'Cancel' } ).click();
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();

		await expect(
			page.getByRole( 'button', { name: 'Save narration' } )
		).toBeVisible( { timeout: 180_000 } );
		// Exactly one preview player — not one per surviving pipeline.
		await expect( page.locator( '.post-voice-panel audio' ) ).toHaveCount(
			1
		);
	} );
} );
