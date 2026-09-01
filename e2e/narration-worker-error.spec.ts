import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import { openNarrationPanel } from './open-narration-panel';

// Short on purpose — the first test proves a fast, visible failure, not a
// real generation. See e2e/narration-fallbacks.spec.ts for the sibling
// pattern this borrows (a route intercept that changes what the editor
// receives).
const NARRATION_TEXT = 'Hello world, this is a test post.';

test( 'shows an error instead of hanging when the Worker fails to start', async ( {
	admin,
	editor,
	page,
} ) => {
	// The Worker's own script is fetched from a stable filename
	// (`pocket-tts-worker.js`, a webpack entry — see Achado 5) with a
	// cache-busting `?ver=` query string PHP appends, so the glob below
	// matches on the extension, not an exact name, and stays correct across
	// version bumps; matched by content rather than name for the same
	// reason. Every matching request is corrupted, deliberately: with the retry from
	// Achado 4, the second (single-threaded) attempt fetches this same URL
	// again and must fail too, so the test still proves the *eventual*
	// visible-error case, not a lucky recovery.
	await page.route(
		'**/wp-content/plugins/post-voice/build/*.js*',
		async ( route ) => {
			const response = await route.fetch();
			const body = await response.text();
			if ( body.includes( 'Worker Thread Started' ) ) {
				await route.fulfill( {
					response,
					body: 'throw new Error("simulated worker crash");',
				} );
				return;
			}
			await route.fulfill( { response, body } );
		}
	);

	await admin.createNewPost( { title: 'Worker crash' } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content: NARRATION_TEXT },
	} );
	await editor.saveDraft();
	await openNarrationPanel( page );
	await page
		.getByRole( 'button', { name: 'Generate audio', exact: true } )
		.click();
	await expect( page.getByRole( 'alert' ) ).toContainText(
		'simulated worker crash',
		{ timeout: 15_000 }
	);
} );

test( 'retries single-threaded and still completes when only the first Worker attempt fails', async ( {
	admin,
	editor,
	page,
} ) => {
	// Corrupt only the first matching fetch (the multi-thread attempt);
	// every later one (the retry, Achado 4) gets the real script.
	let attempts = 0;
	await page.route(
		'**/wp-content/plugins/post-voice/build/*.js*',
		async ( route ) => {
			const response = await route.fetch();
			const body = await response.text();
			if ( body.includes( 'Worker Thread Started' ) ) {
				attempts += 1;
				if ( attempts === 1 ) {
					await route.fulfill( {
						response,
						body: 'throw new Error("simulated first-attempt crash");',
					} );
					return;
				}
			}
			await route.fulfill( { response, body } );
		}
	);

	await admin.createNewPost( { title: 'Worker retry' } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content: NARRATION_TEXT },
	} );
	await editor.saveDraft();
	await openNarrationPanel( page );
	await page
		.getByRole( 'button', { name: 'Generate audio', exact: true } )
		.click();
	// A real generation, on the retry's single thread — the fallback e2e
	// scenario's single-threaded run takes ~46s; budget for that plus the
	// failed first attempt and the download this post's Worker instance
	// hasn't cached yet.
	await expect(
		page.getByRole( 'button', { name: 'Save narration', exact: true } )
	).toBeVisible( { timeout: 180_000 } );
} );
