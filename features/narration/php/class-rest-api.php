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
	 * The predefined voices every Pocket TTS bundle ships, mirrored from the
	 * editor's `voice-catalog.ts`. Validated here as well because a disabled
	 * control in the panel is UX, not a guarantee: the endpoint is reachable
	 * directly, and the value ends up in post meta the frontend trusts.
	 */
	public const ALLOWED_VOICES = array( 'alba', 'azelma', 'cosette', 'eponine', 'fantine', 'javert', 'jean', 'marius' );

	/**
	 * Register the single narration route.
	 */
	public static function register_routes(): void {
		$args = array(
			'id' => array(
				'validate_callback' => static fn( $value ) => is_numeric( $value ),
			),
		);

		register_rest_route(
			self::REST_NAMESPACE,
			self::ROUTE,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( self::class, 'handle_save_narration' ),
					'permission_callback' => array( self::class, 'check_permission' ),
					'args'                => $args,
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( self::class, 'handle_delete_narration' ),
					'permission_callback' => array( self::class, 'check_delete_permission' ),
					'args'                => $args,
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

		// Fase 1 supports the `post` type only, and the panel is enqueued nowhere
		// else — but the endpoint is reachable directly, so the same rule has to
		// hold here. Without it a narration saved against a page produced an
		// attachment and four meta rows that nothing can ever read back: the
		// frontend renders on `is_singular( 'post' )`, the assets enqueue on the
		// same test, and the meta is registered for `post` alone. Write-only
		// media, invisible to the UI that would let someone remove it. This is
		// also the single seam to relax when other post types are supported.
		if ( 'post' !== get_post_type( $post_id ) ) {
			return new WP_Error(
				'post_voice_unsupported_post_type',
				__( 'Narration is only available for posts.', 'post-voice' ),
				array( 'status' => 400 )
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
	 * Authorise removing a post's narration.
	 *
	 * Editing the post is not enough. This deletes files from the Media Library,
	 * and WordPress treats that as its own permission — a role can be allowed to
	 * write posts without being allowed to destroy media. Every narration about
	 * to go is checked individually, because `delete_post` on an attachment
	 * depends on who uploaded it.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return true|WP_Error
	 */
	public static function check_delete_permission( WP_REST_Request $request ) {
		$post_id = (int) $request->get_param( 'id' );

		if ( 'post' !== get_post_type( $post_id ) ) {
			return new WP_Error(
				'post_voice_unsupported_post_type',
				__( 'Narration is only available for posts.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error(
				'post_voice_forbidden',
				__( 'Your role does not have permission to edit this post.', 'post-voice' ),
				array( 'status' => 403 )
			);
		}

		foreach ( Post_Voice_Post_Meta::get_narration_attachment_ids( $post_id ) as $attachment_id ) {
			if ( ! self::can_destroy_narration( $attachment_id ) ) {
				return new WP_Error(
					'post_voice_forbidden',
					__( 'Your role does not have permission to delete this audio. Ask an administrator.', 'post-voice' ),
					array( 'status' => 403 )
				);
			}
		}

		return true;
	}

	/**
	 * Remove a post's narration: the audio files and the meta pointing at them.
	 *
	 * Deletes by marker, never by the ID in `_narration_attachment_id`: that meta
	 * is REST-writable by anyone who can edit the post, so trusting it would let
	 * an author aim this endpoint at someone else's media. Same rule as the
	 * cleanup hook, for the same reason.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_delete_narration( WP_REST_Request $request ) {
		$post_id    = (int) $request->get_param( 'id' );
		$narrations = Post_Voice_Post_Meta::get_narration_attachment_ids( $post_id );
		$had_meta   = (bool) Post_Voice_Post_Meta::get_attachment_id( $post_id );

		if ( ! $narrations && ! $had_meta ) {
			return new WP_Error(
				'post_voice_no_narration',
				__( 'This post has no narration to remove.', 'post-voice' ),
				array( 'status' => 404 )
			);
		}

		$deleted = 0;
		foreach ( $narrations as $attachment_id ) {
			// Re-checked here, not just in the permission callback: a save landing
			// between the two would otherwise put an attachment in this list that
			// nobody authorised. And the count reports what actually went, not what
			// was intended — wp_delete_attachment() returns false when the delete
			// fails, and calling that a success would be a lie the panel repeats.
			if ( ! self::can_destroy_narration( $attachment_id ) ) {
				continue;
			}
			if ( wp_delete_attachment( $attachment_id, true ) ) {
				++$deleted;
			}
		}

		// Also runs when the list was empty: a narration saved before the marker
		// existed leaves meta pointing at audio this endpoint will not delete, and
		// leaving that meta behind would keep the panel and the frontend player
		// advertising audio the author just asked to be rid of.
		Post_Voice_Post_Meta::clear( $post_id );

		return new WP_REST_Response(
			array( 'deleted' => $deleted ),
			200
		);
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

		// Absent means single-language, which is what every Fase 1 client sends.
		$languages_param = (string) $request->get_param( 'languages' );
		$languages_raw   = '' === $languages_param
			? array( $language )
			: array_values( array_filter( array_map( 'trim', explode( ',', $languages_param ) ) ) );

		// Bounded before anything else touches it: a client sending 10,000 entries
		// (valid, invalid, or duplicated) should not get a `foreach` or a dedupe
		// pass over them — cardinality can never legitimately exceed the number of
		// bundles that exist, so a list longer than that is rejected outright.
		if ( count( $languages_raw ) > count( self::ALLOWED_LANGUAGES ) ) {
			return new WP_Error(
				'post_voice_invalid_language',
				__( 'Too many languages.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}

		$languages = array_values( array_unique( $languages_raw ) );

		foreach ( $languages as $candidate ) {
			if ( ! in_array( $candidate, self::ALLOWED_LANGUAGES, true ) ) {
				return new WP_Error(
					'post_voice_invalid_language',
					__( 'Unsupported narration language.', 'post-voice' ),
					array( 'status' => 400 )
				);
			}
		}

		// The primary language names the bundle the panel opened on, so audio that
		// does not contain it means the client and the meta disagree about what was
		// generated — and the meta is what the panel trusts afterwards.
		if ( ! in_array( $language, $languages, true ) ) {
			return new WP_Error(
				'post_voice_invalid_language',
				__( 'The primary language must be one of the languages used.', 'post-voice' ),
				array( 'status' => 400 )
			);
		}

		$voice = (string) $request->get_param( 'voice' );
		if ( ! in_array( $voice, self::ALLOWED_VOICES, true ) ) {
			return new WP_Error(
				'post_voice_invalid_voice',
				__( 'Unsupported narration voice.', 'post-voice' ),
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

		// Name every narration uniquely instead of taking the client's
		// `narration.mp3`. Deleting the superseded attachment frees its filename,
		// so the next upload was handed the same name and therefore the same URL —
		// and an unchanged URL is indistinguishable from unchanged audio. The
		// editor's `<audio>` element sees a `src` string that did not change and
		// keeps playing the buffer it already has, so the author saves a new
		// narration and hears the previous one; a reader's HTTP cache does the
		// same. `wp_unique_filename()` cannot help here: at the moment it runs,
		// the old file is already gone.
		//
		// The random suffix is not decoration: the timestamp alone repeats when two
		// saves land in the same second, which is exactly what a double-click does.
		$files['audio']['name'] = sprintf(
			'narration-%d-%s-%s.mp3',
			$post_id,
			gmdate( 'YmdHis' ),
			wp_generate_password( 6, false )
		);

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

		Post_Voice_Post_Meta::mark_attachment( $attachment_id );

		// Narrations saved before the marker existed carry none, so claim the one
		// the meta already points at — but only after proving it is plausibly this
		// plugin's own audio and that the caller could destroy it anyway.
		//
		// `_narration_attachment_id` is REST-writable by anyone who can edit the
		// post, so an unguarded claim here was a delete-anything hole wearing a
		// different hat: point the meta at media an editor uploaded to this post,
		// save a narration, and the marker planted below made that file a
		// legitimate target for the sweep, which force-deletes without asking
		// anyone's permission. The capability check is the one that matters; the
		// structural checks keep the marker off objects that were never audio.
		if (
			$previous_attachment_id
			&& $previous_attachment_id !== $attachment_id
			&& 'attachment' === get_post_type( $previous_attachment_id )
			&& (int) get_post_field( 'post_parent', $previous_attachment_id ) === $post_id
			&& 'audio/mpeg' === get_post_mime_type( $previous_attachment_id )
			&& self::can_destroy_narration( $previous_attachment_id )
		) {
			Post_Voice_Post_Meta::mark_attachment( $previous_attachment_id );
		}

		$kept_attachment_id = self::sweep_superseded_narrations( $post_id, $attachment_id );

		Post_Voice_Post_Meta::save( $post_id, $kept_attachment_id, $language, $languages, $voice, $source_hash );

		return new WP_REST_Response(
			array(
				'attachment_id' => $kept_attachment_id,
				'url'           => wp_get_attachment_url( $kept_attachment_id ),
				'generated_at'  => get_the_date( 'c', $kept_attachment_id ),
				'language'      => $language,
				// Echoed so the editor records what was actually stored rather
				// than re-deriving it from its own request. The other four keys
				// already came back from here; leaving this one out meant the
				// panel wrote the list it had sent, which agreed only as long as
				// nothing between the two ever normalised it.
				'languages'     => $languages,
				'voice'         => $voice,
			),
			200
		);
	}

	/**
	 * Leave the post with exactly one narration attachment: the newest.
	 *
	 * Deleting only the ID recorded in post meta was not enough. Two saves in
	 * flight at once — a double-click on Save, two editor tabs, a retried
	 * request — each read that meta before the other wrote it, so neither
	 * deleted the other's upload and the post ended up with two audio files
	 * while the meta pointed at whichever request happened to finish last,
	 * frequently the older one.
	 *
	 * Sweeping by "highest attachment ID wins" makes the outcome independent of
	 * completion order: every concurrent request reaches the same verdict, and
	 * the loser's response reports the survivor rather than its own upload. It
	 * also clears out orphans left behind by earlier saves that raced.
	 *
	 * Only attachments carrying the plugin's marker are ever considered, so
	 * audio the author attached to the post by hand is untouched.
	 *
	 * @param int $post_id       Post being narrated.
	 * @param int $attachment_id Attachment this request just created.
	 * @return int Attachment the post should keep.
	 */
	private static function sweep_superseded_narrations( int $post_id, int $attachment_id ): int {
		$narrations = Post_Voice_Post_Meta::get_narration_attachment_ids( $post_id );
		if ( ! $narrations ) {
			return $attachment_id;
		}

		$keep = max( $narrations );

		foreach ( $narrations as $narration_id ) {
			// Skipping rather than deleting when the caller lacks the capability:
			// the marker is a strong signal, not proof, and this path and the
			// DELETE endpoint must not disagree about who may destroy media. A
			// skipped file stays in the Media Library, which is recoverable; a
			// wrongly deleted one is not.
			if ( $narration_id !== $keep && self::can_destroy_narration( $narration_id ) ) {
				wp_delete_attachment( $narration_id, true );
			}
		}

		return $keep;
	}

	/**
	 * Whether the current user may destroy this narration file.
	 *
	 * One helper for both paths on purpose. The save-time sweep and the DELETE
	 * endpoint remove the same objects for the same reason, and when only one of
	 * them checked, the unchecked one became the exploit.
	 *
	 * @param int $attachment_id Attachment about to be deleted.
	 */
	private static function can_destroy_narration( int $attachment_id ): bool {
		return current_user_can( 'delete_post', $attachment_id );
	}
}
