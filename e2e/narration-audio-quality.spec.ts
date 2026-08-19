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

// Deliberately over the ~50-token max_token_per_chunk with no early pause:
// comma-heavy clauses, a colon-introduced clause, a parenthetical, and a
// quoted phrase — the exact combination issue #5 reported as cutting mid-word
// or mid-clause under the old raw-token split.
const OVERSIZED_PUNCTUATED_SENTENCE =
	'The engineer explained the failure calmly, in careful detail, ' +
	'walking through each step of the process: the model loaded ' +
	'correctly, the voice cache warmed up as expected, and only then did ' +
	'the narrator turn to the paragraph that had been flagged as ' +
	'suspicious (the one the reviewer quoted directly as "impossible to ' +
	'sit through"), before finally admitting the real cause had been ' +
	'hiding in plain sight the whole time.';

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
		const audio = page.locator( '.post-voice-player audio' );
		await expect( audio ).toHaveCount( 1 );
		// Regression guard for issue #5's actual production symptom: state
		// carried across internal chunks broke the model's own end-of-speech
		// signal, and every chunk after the first stopped after ~1 frame —
		// audio that "generates without error" but is capped at ~10s no
		// matter how long the paragraph is. This paragraph reads in ~20s at a
		// normal pace; 12s sits well above the truncation bug's ceiling and
		// well below the real duration, so this fails loudly if the bug
		// returns without needing to intercept the worker's internal
		// `postMessage` traffic.
		await expect
			.poll( () =>
				audio.evaluate( ( el: HTMLAudioElement ) => el.duration )
			)
			.toBeGreaterThan( 12 );
	} );

	test( 'a sentence with commas, a colon, a parenthetical, and a quote past the token limit generates without error', async ( {
		admin,
		editor,
		page,
	} ) => {
		await createNarratableDraft(
			admin,
			editor,
			'Punctuated long sentence narration',
			OVERSIZED_PUNCTUATED_SENTENCE
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
		const audio = page.locator( '.post-voice-player audio' );
		await expect( audio ).toHaveCount( 1 );
		// Same regression guard as the long-paragraph test above. This single
		// sentence reads in ~25-30s; 12s is well above the truncation bug's
		// ~10s ceiling and well below the real duration.
		await expect
			.poll( () =>
				audio.evaluate( ( el: HTMLAudioElement ) => el.duration )
			)
			.toBeGreaterThan( 12 );
	} );
} );
