import type { Page } from '@playwright/test';

/**
 * Open the plugin's own Narration sidebar.
 *
 * `getByRole( 'button', { name: 'Narration', exact: true } )` — which every
 * Fase 1 spec used — became ambiguous the moment Task 12 landed: its per-block
 * `InspectorControls` panel is *also* titled "Narration" (see
 * `block-narration-attributes.ts`), and the block inspector is open by default
 * on a freshly inserted block. Two buttons then carry the exact same accessible
 * name — the plugin sidebar's own toggle and that panel's `PanelBody` header —
 * and Playwright's strict mode rightly refuses to guess.
 *
 * `aria-controls` pins this to the `PluginSidebar` (`name="post-voice-panel"`
 * in `index.tsx`) specifically, regardless of what else happens to be open.
 *
 * That two controls share one accessible name is a real accessibility question,
 * not only a test one; it is recorded in Task 17's report for a human decision,
 * because renaming either is a user-facing string change.
 *
 * @param page Playwright page.
 */
export async function openNarrationPanel( page: Page ): Promise< void > {
	await page
		.locator( 'button[aria-controls="post-voice:post-voice-panel"]' )
		.click();
}
