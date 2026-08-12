/**
 * `@wordpress/scripts` ships its configs as plain CommonJS with no type
 * declarations, so importing the Playwright base config from a `.ts` file is an
 * implicit `any` under `strict`. Declaring it as a PlaywrightTestConfig keeps
 * playwright.config.ts type-checked rather than silently untyped.
 */
declare module '@wordpress/scripts/config/playwright.config.js' {
	import type { PlaywrightTestConfig } from '@playwright/test';

	const config: PlaywrightTestConfig;
	export default config;
}
