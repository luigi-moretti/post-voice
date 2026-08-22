import { test, expect } from '@wordpress/e2e-test-utils-playwright';

// No post content, no generation, no model download: these three scenarios
// only need to observe response headers on a page load, so they stay cheap —
// unlike almost everything else in this suite (see TESTING.md).

test( 'sends the isolation headers on the post editor by default', async ( {
	admin,
	page,
} ) => {
	await admin.visitAdminPage( 'post-new.php' );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		true
	);
} );

test( 'does not send the isolation headers on an unrelated admin screen', async ( {
	admin,
	page,
} ) => {
	await admin.visitAdminPage( 'edit.php' );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		false
	);
} );

test( 'does not send the isolation headers when editing a different post type', async ( {
	admin,
	page,
} ) => {
	await admin.visitAdminPage( 'post-new.php', 'post_type=page' );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		false
	);
} );
