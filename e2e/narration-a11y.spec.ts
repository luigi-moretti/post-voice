import path from 'node:path';
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { RequestUtils } from '@wordpress/e2e-test-utils-playwright';
import AxeBuilder from '@axe-core/playwright';

const BLOCKING_IMPACTS = [ 'serious', 'critical' ];

test( 'editor panel has zero serious/critical accessibility violations', async ( {
	admin,
	page,
} ) => {
	await admin.createNewPost( { title: 'A11y editor' } );
	await page
		.getByRole( 'button', { name: 'Narration', exact: true } )
		.click();

	const results = await new AxeBuilder( { page } )
		.include( '.post-voice-panel' )
		.analyze();
	const blocking = results.violations.filter( ( v ) =>
		BLOCKING_IMPACTS.includes( v.impact ?? '' )
	);
	expect( blocking ).toEqual( [] );
} );

/**
 * Publish a post that already has narration attached.
 *
 * The frontend tests below need that state to exist: the renderer returns the
 * content untouched when `_narration_attachment_id` is absent, so a plain
 * createPost() would leave no player markup to assert against. Writing the meta
 * over REST works because all three keys are registered with `show_in_rest`.
 *
 * @param requestUtils REST helper from the Playwright fixtures.
 * @param title        Title for the created post.
 */
async function createPostWithNarration(
	requestUtils: RequestUtils,
	title: string
) {
	const post = await requestUtils.createPost( {
		title,
		status: 'publish',
		// Required by CreatePostPayload even though WordPress would default it.
		date_gmt: new Date().toISOString(),
	} );
	const media = await requestUtils.uploadMedia(
		path.join( __dirname, 'fixtures', 'sample.mp3' )
	);
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/media/${ media.id }`,
		data: { post: post.id },
	} );
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/posts/${ post.id }`,
		data: {
			meta: {
				_narration_attachment_id: media.id,
				_narration_language: 'portuguese',
				_narration_source_hash: 'a'.repeat( 64 ),
			},
		},
	} );
	return post;
}

test( 'frontend player has zero serious/critical accessibility violations', async ( {
	page,
	requestUtils,
} ) => {
	const post = await createPostWithNarration( requestUtils, 'A11y frontend' );
	await page.goto( `/?p=${ post.id }` );

	const results = await new AxeBuilder( { page } )
		.include( '.post-voice-player' )
		.analyze();
	const blocking = results.violations.filter( ( v ) =>
		BLOCKING_IMPACTS.includes( v.impact ?? '' )
	);
	expect( blocking ).toEqual( [] );
} );

test( 'player controls are fully operable by keyboard', async ( {
	page,
	requestUtils,
} ) => {
	const post = await createPostWithNarration( requestUtils, 'Keyboard nav' );
	await page.goto( `/?p=${ post.id }` );

	const playButton = page.locator( '[data-role="play"]' );
	await playButton.focus();
	await page.keyboard.press( 'Enter' );
	await expect( playButton ).toHaveAttribute( 'aria-pressed', 'true' );

	// The progress bar sits between play and speed, matching the approved layout.
	// It is a range input so arrow keys seek without any handling of our own.
	await page.keyboard.press( 'Tab' );
	await expect( page.locator( '[data-role="seek"]' ) ).toBeFocused();

	await page.keyboard.press( 'Tab' );
	await expect( page.locator( '[data-role="rate"]' ) ).toBeFocused();
	await page.keyboard.press( 'Enter' );
	await expect( page.locator( '[data-role="rate"]' ) ).toHaveText( '1.25×' );

	await page.keyboard.press( 'Tab' );
	await expect( page.locator( '[data-role="close"]' ) ).toBeFocused();
	await page.keyboard.press( 'Space' );
	await expect( page.locator( '.post-voice-player' ) ).toBeHidden();
} );

test( 'respects prefers-reduced-motion', async ( { page, requestUtils } ) => {
	await page.emulateMedia( { reducedMotion: 'reduce' } );
	const post = await createPostWithNarration(
		requestUtils,
		'Reduced motion'
	);
	await page.goto( `/?p=${ post.id }` );

	await expect( page.locator( '.post-voice-player' ) ).toHaveClass(
		/post-voice-player--no-motion/
	);
} );
