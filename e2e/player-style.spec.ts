import path from 'node:path';
import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { RequestUtils } from '@wordpress/e2e-test-utils-playwright';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BLOCKING_IMPACTS = [ 'serious', 'critical' ];

/**
 * Publish a post that already has narration attached.
 *
 * The renderer returns the content untouched without
 * `_narration_attachment_id`, so a plain createPost() would leave no player to
 * assert against.
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

/**
 * Set the accent colour through the real screen and save.
 *
 * @param page Playwright page, already on the settings screen.
 * @param hex  Colour to type into the accent field.
 */
async function setAccent( page: Page, hex: string ) {
	const accent = page.locator( '#post-voice-style-accent' );
	await accent.fill( hex );
	await page.getByRole( 'button', { name: 'Save Changes' } ).click();
	await expect(
		page.locator( '#setting-error-settings_updated' )
	).toBeVisible();
}

test.describe( 'player styling', () => {
	test.afterEach( async ( { admin, page } ) => {
		// Every scenario shares one site-wide option, so each one puts it back.
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
		await page.getByRole( 'button', { name: 'Restore defaults' } ).click();
		await page.getByRole( 'button', { name: 'Save Changes' } ).click();
	} );

	test( 'an uncustomised site ships no inline player CSS', async ( {
		page,
		requestUtils,
	} ) => {
		const post = await createPostWithNarration(
			requestUtils,
			'No styling'
		);
		await page.goto( `/?p=${ post.id }` );

		await expect(
			page.locator( 'style#post-voice-player-inline-css' )
		).toHaveCount( 0 );
	} );

	test( 'a saved accent reaches the reader', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const post = await createPostWithNarration(
			requestUtils,
			'Red accent'
		);

		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
		await setAccent( page, '#c00000' );

		await page.goto( `/?p=${ post.id }` );
		const playButton = page.locator( '[data-role="play"]' );
		await expect( playButton ).toBeVisible();
		await expect( playButton ).toHaveCSS(
			'background-color',
			'rgb(192, 0, 0)'
		);
	} );

	test( 'the preview follows the field before anything is saved', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );

		const previewPlay = page.locator(
			'.post-voice-preview [data-role="play"]'
		);
		await expect( previewPlay ).toHaveCSS(
			'background-color',
			'rgb(43, 98, 240)'
		);

		await page.locator( '#post-voice-style-accent' ).fill( '#c00000' );
		await expect( previewPlay ).toHaveCSS(
			'background-color',
			'rgb(192, 0, 0)'
		);

		// Not saved: a reload must bring the shipped colour back.
		await page.reload();
		await expect( previewPlay ).toHaveCSS(
			'background-color',
			'rgb(43, 98, 240)'
		);
	} );

	test( 'a low-contrast choice warns and still saves', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );

		await page.locator( '#post-voice-style-surface' ).fill( '#ffffff' );
		await expect(
			page.locator( '.post-voice-contrast-warning' )
		).toContainText( 'Low contrast' );

		await page.getByRole( 'button', { name: 'Save Changes' } ).click();
		await expect(
			page.locator( '#setting-error-settings_updated' )
		).toBeVisible();
		await expect( page.locator( '#post-voice-style-surface' ) ).toHaveValue(
			'#ffffff'
		);
	} );

	test( 'the settings screen has zero serious/critical accessibility violations', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'options-general.php', 'page=post-voice' );
		await expect( page.locator( '.post-voice-preview' ) ).toBeVisible();

		const results = await new AxeBuilder( { page } )
			.include( '.wrap' )
			.analyze();
		const blocking = results.violations.filter( ( v ) =>
			BLOCKING_IMPACTS.includes( v.impact ?? '' )
		);
		expect( blocking ).toEqual( [] );
	} );
} );
