import { test, expect } from '@wordpress/e2e-test-utils-playwright';

// Short on purpose: every second of synthesised audio is a second of test runtime.
const NARRATION_TEXT = 'Hello world, this is a test post.';

test.describe( 'Post Voice — narration generation', () => {
	test( 'author generates, previews, and saves narration end to end', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost( {
			title: 'Narration happy path',
		} );
		// Two things createNewPost() does not do, both of which the panel cares about.
		//
		// It passes `content` as a query argument, and WordPress parses raw text with
		// no block delimiters into a `core/freeform` (classic) block — which is not in
		// the narratable block list, so extraction returns an empty string and the
		// panel reports "No readable text found". Insert a real paragraph instead.
		//
		// It also leaves the post at status `auto-draft`. The panel disables
		// generation in that state (and the REST endpoint answers 409), so the
		// Generate button never becomes clickable until a draft is saved.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: NARRATION_TEXT },
		} );
		await editor.saveDraft();
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
		const permalink = await page
			.locator( 'a.components-external-link' )
			.first()
			.getAttribute( 'href' );
		await page.goto( permalink! );
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
		await admin.createNewPost( {
			title: 'Regenerate test',
		} );
		// Two things createNewPost() does not do, both of which the panel cares about.
		//
		// It passes `content` as a query argument, and WordPress parses raw text with
		// no block delimiters into a `core/freeform` (classic) block — which is not in
		// the narratable block list, so extraction returns an empty string and the
		// panel reports "No readable text found". Insert a real paragraph instead.
		//
		// It also leaves the post at status `auto-draft`. The panel disables
		// generation in that state (and the REST endpoint answers 409), so the
		// Generate button never becomes clickable until a draft is saved.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: NARRATION_TEXT },
		} );
		await editor.saveDraft();
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
		await admin.createNewPost( {
			title: 'Cancel test',
		} );
		// Two things createNewPost() does not do, both of which the panel cares about.
		//
		// It passes `content` as a query argument, and WordPress parses raw text with
		// no block delimiters into a `core/freeform` (classic) block — which is not in
		// the narratable block list, so extraction returns an empty string and the
		// panel reports "No readable text found". Insert a real paragraph instead.
		//
		// It also leaves the post at status `auto-draft`. The panel disables
		// generation in that state (and the REST endpoint answers 409), so the
		// Generate button never becomes clickable until a draft is saved.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: NARRATION_TEXT },
		} );
		await editor.saveDraft();
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
		await admin.createNewPost( {
			title: 'Cancel then regenerate',
		} );
		// Two things createNewPost() does not do, both of which the panel cares about.
		//
		// It passes `content` as a query argument, and WordPress parses raw text with
		// no block delimiters into a `core/freeform` (classic) block — which is not in
		// the narratable block list, so extraction returns an empty string and the
		// panel reports "No readable text found". Insert a real paragraph instead.
		//
		// It also leaves the post at status `auto-draft`. The panel disables
		// generation in that state (and the REST endpoint answers 409), so the
		// Generate button never becomes clickable until a draft is saved.
		await editor.insertBlock( {
			name: 'core/paragraph',
			attributes: { content: NARRATION_TEXT },
		} );
		await editor.saveDraft();
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
