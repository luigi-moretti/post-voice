import { test, expect } from '@wordpress/e2e-test-utils-playwright';

test( 'generates audio single-threaded when crossOriginIsolated is unavailable', async ( {
	admin,
	page,
} ) => {
	await page.route( '**/wp-admin/post-new.php*', async ( route ) => {
		const response = await route.fetch();
		const headers = { ...response.headers() };
		delete headers[ 'cross-origin-opener-policy' ];
		delete headers[ 'cross-origin-embedder-policy' ];
		await route.fulfill( { response, headers } );
	} );

	await admin.createNewPost( {
		title: 'No isolation fallback',
		content: 'Short narration text.',
	} );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		false
	);

	await page.getByRole( 'button', { name: 'Narration' } ).click();
	await page.getByRole( 'button', { name: 'Generate audio' } ).click();
	await expect(
		page.getByRole( 'button', { name: 'Save narration' } )
	).toBeVisible( { timeout: 180_000 } );
} );

test( 'warns before downloading the model when storage is insufficient', async ( {
	admin,
	page,
} ) => {
	await page.addInitScript( () => {
		// Test-only override: force the storage pre-check down its failure path
		// without needing a genuinely full disk.
		navigator.storage.estimate = async () => ( {
			quota: 50_000_000,
			usage: 49_000_000,
		} );
	} );
	await admin.createNewPost( { title: 'Storage warning', content: 'Text.' } );
	await page.getByRole( 'button', { name: 'Narration' } ).click();
	await page.getByRole( 'button', { name: 'Generate audio' } ).click();
	await expect( page.getByRole( 'alert' ) ).toContainText( /storage|space/i );
} );
