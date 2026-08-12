<?php
/**
 * Narration REST endpoint.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Thin upsert endpoint: takes a finished audio blob and attaches it to a post.
 *
 * No TTS happens here — inference runs entirely in the browser. This class only
 * validates, stores the attachment, and records the meta.
 */
class Post_Voice_Rest_Api {

	private const REST_NAMESPACE = 'post-voice/v1';
	private const ROUTE          = '/posts/(?P<id>\d+)/narration';

	public const ALLOWED_LANGUAGES = array( 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' );

	/**
	 * Register the single narration route.
	 */
	public static function register_routes(): void {
		register_rest_route(
			self::REST_NAMESPACE,
			self::ROUTE,
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( self::class, 'handle_save_narration' ),
				'permission_callback' => array( self::class, 'check_permission' ),
				'args'                => array(
					'id' => array(
						'validate_callback' => static fn( $value ) => is_numeric( $value ),
					),
				),
			)
		);
	}

	/**
	 * Authorise the request.
	 *
	 * Requires both `edit_post` on the target post and `upload_files`, because the
	 * request results in a Media Library attachment.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return true|WP_Error
	 */
	public static function check_permission( WP_REST_Request $request ) {
		$post_id = (int) $request->get_param( 'id' );

		if ( ! current_user_can( 'edit_post', $post_id ) || ! current_user_can( 'upload_files' ) ) {
			return new WP_Error(
				'post_voice_forbidden',
				__( 'Your role does not have permission to add media. Ask an administrator.', 'post-voice' ),
				array( 'status' => 403 )
			);
		}

		if ( 'auto-draft' === get_post_status( $post_id ) ) {
			return new WP_Error(
				'post_voice_post_not_saved',
				__( 'Save the post before generating narration.', 'post-voice' ),
				array( 'status' => 409 )
			);
		}

		return true;
	}

	/**
	 * Store the uploaded MP3 and point the post's meta at it.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_save_narration( WP_REST_Request $request ) {
		$post_id = (int) $request->get_param( 'id' );
		$files   = $request->get_file_params();

		if ( empty( $files['audio']['tmp_name'] ) ) {
			return new WP_Error(
				'post_voice_missing_audio',
				__( 'No audio file was received.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}

		$language = (string) $request->get_param( 'language' );
		if ( ! in_array( $language, self::ALLOWED_LANGUAGES, true ) ) {
			return new WP_Error(
				'post_voice_invalid_language',
				__( 'Unsupported narration language.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}

		$source_hash = (string) $request->get_param( 'source_hash' );
		if ( ! preg_match( '/^[a-f0-9]{64}$/', $source_hash ) ) {
			return new WP_Error(
				'post_voice_invalid_hash',
				__( 'Malformed source hash.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}

		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		$previous_attachment_id = Post_Voice_Post_Meta::get_attachment_id( $post_id );

		// Deliberately NOT media_handle_upload(): that reads the $_FILES
		// superglobal, which a REST request's file params never populate. This is
		// the path WP core's own attachments controller takes — wp_handle_upload()
		// on the file array from the request, then an explicit
		// wp_insert_attachment().
		$overrides = array(
			'test_form' => false,
			'mimes'     => array( 'mp3' => 'audio/mpeg' ),
		);

		// wp_handle_upload() moves the file with move_uploaded_file(), which by
		// design fails for anything PHP did not receive as an HTTP upload — so it
		// fails under PHPUnit, where the file is staged on disk. Naming a different
		// action switches WordPress to a copy, and gating it on DIR_TESTDATA keeps
		// the real is_uploaded_file() check in place everywhere else. This is the
		// same escape hatch WP core's own attachments controller uses.
		if ( defined( 'DIR_TESTDATA' ) && DIR_TESTDATA ) {
			$overrides['action'] = 'wp_handle_mock_upload';
		}

		$upload = wp_handle_upload( $files['audio'], $overrides );

		if ( isset( $upload['error'] ) ) {
			return new WP_Error(
				'post_voice_upload_failed',
				$upload['error'],
				array( 'status' => 500 )
			);
		}

		$attachment_id = wp_insert_attachment(
			array(
				'post_mime_type' => $upload['type'],
				'post_title'     => sprintf(
					/* translators: %s: title of the post being narrated. */
					__( 'Narration — %s', 'post-voice' ),
					get_the_title( $post_id )
				),
				'post_content'   => '',
				'post_status'    => 'inherit',
				'post_parent'    => $post_id,
			),
			$upload['file'],
			$post_id,
			true
		);

		if ( is_wp_error( $attachment_id ) ) {
			return new WP_Error(
				'post_voice_upload_failed',
				$attachment_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		wp_update_attachment_metadata(
			$attachment_id,
			wp_generate_attachment_metadata( $attachment_id, $upload['file'] )
		);

		if ( $previous_attachment_id && $previous_attachment_id !== $attachment_id ) {
			wp_delete_attachment( $previous_attachment_id, true );
		}

		Post_Voice_Post_Meta::save( $post_id, $attachment_id, $language, $source_hash );

		return new WP_REST_Response(
			array(
				'attachment_id' => $attachment_id,
				'url'           => wp_get_attachment_url( $attachment_id ),
				'generated_at'  => get_the_date( 'c', $attachment_id ),
				'language'      => $language,
			),
			200
		);
	}
}
