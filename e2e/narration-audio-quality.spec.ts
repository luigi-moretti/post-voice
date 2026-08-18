import { test, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Admin, Editor } from '@wordpress/e2e-test-utils-playwright';
import { openNarrationPanel } from './open-narration-panel';

// Long enough on purpose: this suite exists to exercise multi-chunk paths
// (features/narration/editor/engine/pocket-tts.worker.js splits at ~50 tokens
// per bundle.json's max_token_per_chunk), which "Hello world" style fixtures
// used by every other narration spec never reach.
const LONG_PARAGRAPH =
	'The narrator reads long paragraphs every day, and every day the ' +
	'result sounds a little more mechanical near the middle, as if ' +
	'something quietly resets between each breath. Listeners notice the ' +
	'seams even when they cannot name them, and short posts never show ' +
	'the same problem at all.';

async function createNarratableDraft(
	admin: Admin,
	editor: Editor,
	title: string,
	content: string
) {
	await admin.createNewPost( { title } );
	await editor.insertBlock( {
		name: 'core/paragraph',
		attributes: { content },
	} );
	await editor.saveDraft();
}

test.describe( 'Post Voice — narration audio quality (issue #5)', () => {
	test( 'a long multi-sentence paragraph generates without error across multiple internal chunks', async ( {
		admin,
		editor,
		page,
	} ) => {
		await createNarratableDraft(
			admin,
			editor,
			'Long paragraph narration',
			LONG_PARAGRAPH
		);
		await editor.openDocumentSettingsSidebar();
		await openNarrationPanel( page );
		await page
			.getByRole( 'button', { name: 'Generate audio', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Save narration', exact: true } )
		).toBeVisible( { timeout: 180_000 } );
		await expect(
			page.locator( '.components-notice.is-error' )
		).toHaveCount( 0 );

		await page
			.getByRole( 'button', { name: 'Save narration', exact: true } )
			.click();
		await expect(
			page.getByRole( 'button', { name: 'Generate again', exact: true } )
		).toBeVisible();

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
} );
