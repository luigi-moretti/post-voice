import { test, expect } from '@wordpress/e2e-test-utils-playwright';

// No post content, no generation, no model download: these scenarios only
// need to observe response headers on a page load, so they stay cheap —
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

test( 'sends the isolation headers on post.php too, editing an existing post', async ( {
	admin,
	page,
	requestUtils,
} ) => {
	// `post-new.php` is the only screen the other scenarios in this file
	// visit, but `post.php` (editing a post that already exists) is the
	// common case in production and resolves its post type differently
	// (`resolve_post_type()` looks the post up by ID instead of defaulting
	// to `post`) — nothing else in this suite's header coverage reaches it.
	const post = await requestUtils.createPost( {
		title: 'Existing post',
		status: 'draft',
		// Required by CreatePostPayload even though WordPress would default it.
		date_gmt: new Date().toISOString(),
	} );
	await admin.visitAdminPage( 'post.php', `post=${ post.id }&action=edit` );
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		true
	);
} );

test( 'a site can turn the headers off with the post_voice_send_isolation_headers filter', async ( {
	admin,
	page,
} ) => {
	// `e2e/mu-plugins/isolation-headers-filter-harness.php` wires this query
	// var to the filter — a stand-in for a real site disabling the headers
	// because of a conflict (embed blocks, an OAuth popup — see the filter's
	// own docblock in class-editor-headers.php) without needing a genuine
	// conflicting plugin here.
	await admin.visitAdminPage(
		'post-new.php',
		'post_voice_disable_isolation=1'
	);
	expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
		false
	);
} );

// The site setting behind those headers (Settings → Narration). Driven
// through its own screen rather than by writing the option directly: the
// whole point of the feature is that an author can reach it, and a control
// that renders but never persists would pass a direct-write test.

async function setAcceleration(
	admin: { visitAdminPage: ( p: string, q?: string ) => Promise< void > },
	page: import('@playwright/test').Page,
	enabled: boolean
): Promise< void > {
	await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
	await page.locator( '#post-voice-acceleration' ).setChecked( enabled );
	await page.getByRole( 'button', { name: 'Save Changes' } ).click();
	await expect( page.locator( '#post-voice-acceleration' ) ).toBeChecked( {
		checked: enabled,
	} );
}

test.describe( 'the site setting', () => {
	test.afterEach( async ( { admin, page } ) => {
		await setAcceleration( admin, page, true );
	} );

	test( 'turning acceleration off stops the isolation headers', async ( {
		admin,
		page,
	} ) => {
		// The author-facing remedy for a blank CodePen/YouTube embed in the
		// editor: a cross-origin iframe is blocked outright unless the
		// document is not isolated.
		await setAcceleration( admin, page, false );

		await admin.visitAdminPage( 'post-new.php' );

		expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
			false
		);
	} );

	test( 'turning acceleration back on restores them', async ( {
		admin,
		page,
	} ) => {
		// Not symmetry for its own sake: "off" is stored as a value that
		// WordPress will actually write, and getting that wrong in either
		// direction leaves the setting stuck on whichever side it reached
		// first.
		await setAcceleration( admin, page, false );
		await setAcceleration( admin, page, true );

		await admin.visitAdminPage( 'post-new.php' );

		expect( await page.evaluate( () => window.crossOriginIsolated ) ).toBe(
			true
		);
	} );
} );
