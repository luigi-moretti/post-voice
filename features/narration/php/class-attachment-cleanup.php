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
	 * Delete the narrations belonging to a post being deleted.
	 *
	 * Deliberately does NOT trust `_narration_attachment_id`. That key is
	 * registered `show_in_rest` and authorised with `edit_post`, so anyone who
	 * can edit a post can point it anywhere — including at the site logo or at
	 * another author's media. Deleting whatever it named, with `force_delete`,
	 * handed every Author the power to permanently destroy arbitrary Media
	 * Library files: write the meta over `/wp/v2/posts/<id>`, then trash their
	 * own post. WordPress withholds `delete_others_posts` from Authors on
	 * purpose; this gave it back for attachments, and the file leaves the disk.
	 *
	 * The marker written on every attachment this plugin creates is not
	 * REST-writable — it is unregistered meta on the attachment, protected by
	 * WordPress's own rules — and the query is scoped to this post's children,
	 * so a forged value reaches nothing. Sweeping the whole list rather than one
	 * ID also clears out orphans left by an interrupted or concurrent save,
	 * which the single-ID delete left behind as permanent Media Library litter.
	 *
	 * Consequence worth knowing: a narration saved before the marker existed
	 * carries none and is no longer deleted with its post. Saving again marks
	 * it (see `Post_Voice_Rest_Api::handle_save_narration()`); anything older is
	 * an ordinary Media Library item to remove by hand. That is the safe
	 * direction to fail in — media that survives can be deleted, media that was
	 * destroyed cannot be recovered.
	 *
	 * @param int $post_id Post about to be deleted.
	 */
	public static function delete_narration_on_post_delete( int $post_id ): void {
		foreach ( Post_Voice_Post_Meta::get_narration_attachment_ids( $post_id ) as $attachment_id ) {
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
