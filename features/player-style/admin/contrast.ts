/**
 * WCAG contrast maths for the settings screen's warning.
 *
 * Pure by design: the screen only needs a number, and a number is testable
 * without a browser.
 */

import { expandHex } from './hex-field';

/**
 * One channel of an sRGB colour, linearised per WCAG 2.x.
 *
 * @param channel Channel value, 0-255.
 */
function linearise( channel: number ): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4;
}

/**
 * Relative luminance of a hex colour, 0 (black) to 1 (white).
 *
 * @param hex Three- or six-digit hex colour, with the hash.
 */
export function relativeLuminance( hex: string ): number {
	const full = expandHex( hex.trim().toLowerCase() );
	const r = linearise( parseInt( full.slice( 1, 3 ), 16 ) );
	const g = linearise( parseInt( full.slice( 3, 5 ), 16 ) );
	const b = linearise( parseInt( full.slice( 5, 7 ), 16 ) );
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, from 1 to 21.
 *
 * Order does not matter: the lighter colour is always the numerator.
 *
 * @param a One colour.
 * @param b The other.
 */
export function contrastRatio( a: string, b: string ): number {
	const la = relativeLuminance( a );
	const lb = relativeLuminance( b );
	const lighter = Math.max( la, lb );
	const darker = Math.min( la, lb );
	return ( lighter + 0.05 ) / ( darker + 0.05 );
}
