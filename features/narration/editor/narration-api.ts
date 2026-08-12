import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

export interface SaveNarrationResponse {
	attachment_id: number;
	url: string;
	generated_at: string;
	language: string;
}

/**
 * Upload a finished MP3 and attach it to the post.
 *
 * Goes through `apiFetch` rather than bare `fetch` + the `wpApiSettings` global:
 * that global is localized on the `wp-api-request` script handle, which the
 * editor bundle never depends on (its dependencies are derived from its imports),
 * so it is simply undefined on the page. `apiFetch` already supplies the REST
 * root and the nonce, and the panel uses it for reading the attachment back — one
 * auth path instead of two.
 *
 * `body` is passed through untouched, so the browser sets the multipart
 * `Content-Type` boundary itself. Never pass FormData as `data`: that would be
 * JSON-encoded and arrive as an empty object.
 */
export async function saveNarration(
	postId: number,
	audio: Blob,
	language: string,
	sourceHash: string
): Promise< SaveNarrationResponse > {
	const formData = new FormData();
	formData.append( 'audio', audio, 'narration.mp3' );
	formData.append( 'language', language );
	formData.append( 'source_hash', sourceHash );

	try {
		return await apiFetch< SaveNarrationResponse >( {
			path: `/post-voice/v1/posts/${ postId }/narration`,
			method: 'POST',
			body: formData,
		} );
	} catch ( error ) {
		// apiFetch rejects with the parsed REST error body, not an Error instance,
		// so callers reading `.message` would otherwise get `undefined`.
		const message = ( error as { message?: string } )?.message;
		throw new Error( message || __( 'Failed to save narration.', 'post-voice' ) );
	}
}
