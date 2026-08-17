/**
 * Pure helpers for the settings screen's hex text field.
 *
 * Kept separate from the DOM wiring so they can be tested in Jest: the browser
 * work lives in `preview.ts`, which has an E2E scenario instead.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether a string is a hex colour the server would also accept.
 *
 * Mirrors `sanitize_hex_color()`, which takes three or six digits with a hash
 * and nothing else. The UI restricting the field is convenience; the server
 * validating it is the guarantee.
 *
 * @param value Raw field value.
 */
export function isValidHex( value: string ): boolean {
	return HEX.test( value.trim() );
}

/**
 * Lower-case a valid hex colour, or report that it is not one.
 *
 * The short form is kept short: CSS treats the two alike, and rewriting what
 * the author typed buys nothing.
 *
 * @param value Raw field value.
 * @return The normalised colour, or null when the value is not a hex colour.
 */
export function normalizeHex( value: string ): string | null {
	const trimmed = value.trim();
	return isValidHex( trimmed ) ? trimmed.toLowerCase() : null;
}

/**
 * Lengthen `#abc` into `#aabbcc`.
 *
 * `<input type="color">` accepts only the six-digit form — handed anything
 * else it falls back to black without saying so.
 *
 * @param value A valid hex colour.
 */
export function expandHex( value: string ): string {
	if ( value.length !== 4 ) {
		return value;
	}
	const [ , r, g, b ] = value;
	return `#${ r }${ r }${ g }${ g }${ b }${ b }`;
}
