/**
 * `@wordpress/block-editor` ships no package-level `types` field (unlike
 * `@wordpress/components` and `@wordpress/editor`), so importing from it is an
 * implicit `any` under `strict`. Declares only what this plugin actually uses.
 *
 * `BlockControls` and `store` were added for the inline language format
 * (Task 13), which needs the toolbar slot and the block-editor data store to
 * read the selected block's name.
 */
declare module '@wordpress/block-editor' {
	import type { ComponentType, ReactNode } from 'react';
	import type { StoreDescriptor } from '@wordpress/data';

	export const InspectorControls: ComponentType< { children?: ReactNode } >;

	export const BlockControls: ComponentType< {
		children?: ReactNode;
		group?: string;
	} >;

	export const store: StoreDescriptor;
}
