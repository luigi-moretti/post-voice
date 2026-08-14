import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';

export interface SaveNarrationResponse {
	attachment_id: number;
	url: string;
	generated_at: string;
	language: string;
	voice: string;
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
 * @param postId
 * @param audio
 * @param language
 * @param voice
 * @param sourceHash
 */
export async function saveNarration(
	postId: number,
	audio: Blob,
	language: string,
	voice: string,
	sourceHash: string
): Promise< SaveNarrationResponse > {
	const formData = new FormData();
	formData.append( 'audio', audio, 'narration.mp3' );
	formData.append( 'language', language );
	formData.append( 'voice', voice );
	formData.append( 'source_hash', sourceHash );

	try {
		return await apiFetch< SaveNarrationResponse >( {
			path: `/post-voice/v1/posts/${ postId }/narration`,
			method: 'POST',
			body: formData,
		} );
	} catch ( error ) {
		throw asError( error, __( 'Failed to save narration.', 'post-voice' ) );
	}
}

/**
 * Delete the post's narration: the audio files and the meta pointing at them.
 *
 * @param postId Post to strip.
 */
export async function deleteNarration( postId: number ): Promise< void > {
	try {
		await apiFetch( {
			path: `/post-voice/v1/posts/${ postId }/narration`,
			method: 'DELETE',
		} );
	} catch ( error ) {
		throw asError(
			error,
			__( 'Failed to remove narration.', 'post-voice' )
		);
	}
}

/**
 * Turn whatever apiFetch rejected with into a real Error.
 *
 * It rejects with the parsed REST error body, not an Error instance, so callers
 * reading `.message` on it would otherwise get `undefined`.
 *
 * @param error    Rejection value from apiFetch.
 * @param fallback Message to use when the body carries none.
 */
function asError( error: unknown, fallback: string ): Error {
	const message = ( error as { message?: string } )?.message;
	return new Error( message || fallback );
}
