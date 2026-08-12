<?php
/**
 * Symmetric cleanup between a post and its narration attachment.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Keeps post meta and the Media Library from drifting apart.
 *
 * Post deleted → its narration attachment goes too. Attachment deleted straight
 * from the Media Library → the post's narration meta is cleared, so the editor
 * panel does not keep advertising audio that no longer exists.
 */
class Post_Voice_Attachment_Cleanup {

	/**
	 * Hook both directions of the cleanup.
	 */
	public static function register(): void {
		add_action( 'before_delete_post', array( self::class, 'delete_narration_on_post_delete' ) );
		add_action( 'delete_attachment', array( self::class, 'clear_meta_on_attachment_delete' ) );
	}

	/**
	 * Delete the narration attachment belonging to a post being deleted.
	 *
	 * @param int $post_id Post about to be deleted.
	 */
	public static function delete_narration_on_post_delete( int $post_id ): void {
		$attachment_id = Post_Voice_Post_Meta::get_attachment_id( $post_id );
		if ( $attachment_id ) {
			wp_delete_attachment( $attachment_id, true );
		}
	}

	/**
	 * Clear a post's narration meta when its narration attachment is deleted.
	 *
	 * Only clears when the deleted attachment is the one the meta points at — a
	 * post's featured image shares the same `post_parent`.
	 *
	 * @param int $attachment_id Attachment about to be deleted.
	 */
	public static function clear_meta_on_attachment_delete( int $attachment_id ): void {
		$post_id = (int) get_post_field( 'post_parent', $attachment_id );
		if ( ! $post_id ) {
			return;
		}

		if ( Post_Voice_Post_Meta::get_attachment_id( $post_id ) === $attachment_id ) {
			Post_Voice_Post_Meta::clear( $post_id );
		}
	}
}
