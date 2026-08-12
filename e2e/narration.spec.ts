import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test.describe( 'Post Voice — narration generation', () => {
	test( 'author generates, previews, and saves narration end to end', async ( {
		admin,
		editor,
		page,
	} ) => {
		await admin.createNewPost( {
			title: 'Narration happy path',
			content: 'Hello world, this is a test post.',
		} );
		await editor.openDocumentSettingsSidebar();
		await page.getByRole( 'button', { name: 'Narration' } ).click();
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
		page,
		requestUtils,
	} ) => {
		await admin.createNewPost( {
			title: 'Regenerate test',
			content: 'First version of the text.',
		} );
		await page.getByRole( 'button', { name: 'Narration' } ).click();
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
		page,
	} ) => {
		await admin.createNewPost( {
			title: 'Cancel test',
			content: 'Some text to narrate for cancellation.',
		} );
		await page.getByRole( 'button', { name: 'Narration' } ).click();
		await page.getByRole( 'button', { name: 'Generate audio' } ).click();
		await page.getByRole( 'button', { name: 'Cancel' } ).click();
		await expect(
			page.getByRole( 'button', { name: 'Generate audio' } )
		).toBeVisible();
	} );

	test( 'cancelling and immediately regenerating produces one clean audio file', async ( {
		admin,
		page,
	} ) => {
		// Regression guard for a worker-level race: the vendored worker cancels via a
		// single shared `isGenerating` flag, so a regeneration started before the
		// cancelled pipeline noticed the flag used to leave two pipelines streaming
		// chunks into the same listener. The panel now disposes the worker on cancel.
		await admin.createNewPost( {
			title: 'Cancel then regenerate',
			content: 'Text to narrate twice in a row.',
		} );
		await page.getByRole( 'button', { name: 'Narration' } ).click();
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
