import '@wordpress/rich-text';

/**
 * `@wordpress/rich-text`'s shipped types are generated from JSDoc that never
 * documented `attributes` — on the format object `applyFormat` takes, and on
 * the settings object `registerFormatType` takes — even though the package's
 * own runtime reads it (`to-tree.js`, `to-html-string.js`) to
 * map a format's attribute onto the HTML attribute it is stored as. The same
 * generated types also mark `registerFormatType`'s `name` and `object` as
 * required, when `register-format-type.js` shows `name` is filled in by the
 * function itself (`settings = { name, ...settings }`) and `object` is never
 * required by its validation.
 *
 * `RichTextFormat` and `WPFormat` are `type` aliases, not `interface`s, so
 * they cannot be widened by declaration-merging a field onto them. Adding an
 * overload to the functions that actually accept the shape this plugin uses
 * is the narrower fix — it does not touch what the rest of the module thinks
 * `RichTextFormat`/`WPFormat` are.
 */
declare module '@wordpress/rich-text' {
	function applyFormat(
		value: RichTextValue,
		format: { type: string; attributes?: Record< string, string > },
		startIndex?: number,
		endIndex?: number
	): RichTextValue;

	function registerFormatType(
		name: string,
		settings: {
			title: string;
			tagName: string;
			className?: string | null;
			interactive?: boolean;
			attributes?: Record< string, string >;
			edit: ( props: any ) => any;
		}
	): unknown;
}
