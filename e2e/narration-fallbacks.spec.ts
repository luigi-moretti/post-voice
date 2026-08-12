import { test, expect } from '@wordpress/e2e-test-utils-playwright';

// Short on purpose: every second of synthesised audio is a second of test runtime.
const NARRATION_TEXT = 'Hello world, this is a test post.';

test( 'generates audio single-threaded when crossOriginIsolated is unavailable', async ( {
	admin,
	editor,
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
	editor,
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
	await admin.createNewPost( { title: 'Storage warning' } );
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
	await page.getByRole( 'button', { name: 'Narration' } ).click();
	await page.getByRole( 'button', { name: 'Generate audio' } ).click();
	await expect( page.getByRole( 'alert' ) ).toContainText( /storage|space/i );
} );
