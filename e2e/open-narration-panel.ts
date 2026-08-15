import type { Page } from '@playwright/test';

/**
 * Open the plugin's own Narration sidebar.
 *
 * `getByRole( 'button', { name: 'Narration', exact: true } )` — which every
 * Fase 1 spec used — became ambiguous the moment Task 12 landed: its per-block
 * `InspectorControls` panel was *also* titled "Narration", and the block
 * inspector is open by default on a freshly inserted block. Two buttons then
 * carried the exact same accessible name — the plugin sidebar's own toggle and
 * that panel's `PanelBody` header — and Playwright's strict mode rightly refused
 * to guess. That was an accessibility defect before it was a test one, and Task
 * 18 fixed it at the source: the block panel is now "Narration for this block".
 *
 * This helper stays anyway. `aria-controls` pins it to the `PluginSidebar`
 * (`name="post-voice-panel"` in `index.tsx`) specifically, regardless of what
 * else happens to be open or of what any panel is called next — a name match
 * would go ambiguous again the next time a string is reused, silently and across
 * the whole suite at once.
 *
 * Idempotent, unlike the unconditional click it replaced. Gutenberg persists the
 * active complementary area in user preferences, so a session that ends with the
 * Narration sidebar open reopens the editor with it already showing — and a
 * click then *closes* it. Every caller here means "make sure it is open".
 *
 * @param page Playwright page.
 */
export async function openNarrationPanel( page: Page ): Promise< void > {
	const panel = page.locator( '.post-voice-panel' );
	if ( await panel.isVisible() ) {
		return;
	}
	await page
		.locator( 'button[aria-controls="post-voice:post-voice-panel"]' )
		.click();
	await panel.waitFor( { state: 'visible' } );
}
