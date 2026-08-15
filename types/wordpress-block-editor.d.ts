/**
 * `@wordpress/block-editor` ships no package-level `types` field (unlike
 * `@wordpress/components` and `@wordpress/editor`), so importing from it is an
 * implicit `any` under `strict`. Declares only what this plugin actually uses.
 */
declare module '@wordpress/block-editor' {
	import type { ComponentType, ReactNode } from 'react';

	export const InspectorControls: ComponentType< { children?: ReactNode } >;
}
