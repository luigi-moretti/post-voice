<?php
/**
 * Tests for Post_Voice_Attachment_Cleanup.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Attachment_Cleanup
 */
class Test_Post_Voice_Attachment_Cleanup extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();
		Post_Voice_Attachment_Cleanup::register();
	}

	public function test_deleting_post_deletes_its_narration_attachment(): void {
		$post_id       = self::factory()->post->create();
		$attachment_id = $this->create_narration( $post_id );
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		wp_delete_post( $post_id, true );

		$this->assertNull( get_post( $attachment_id ) );
	}

	public function test_deleting_post_deletes_every_narration_it_accumulated(): void {
		// Orphans from an interrupted or concurrent save. Deleting only the one
		// the meta names left the rest as Media Library litter with a dead parent.
		$post_id = self::factory()->post->create();
		$orphan  = $this->create_narration( $post_id );
		$current = $this->create_narration( $post_id );
		Post_Voice_Post_Meta::save( $post_id, $current, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		wp_delete_post( $post_id, true );

		$this->assertNull( get_post( $orphan ) );
		$this->assertNull( get_post( $current ) );
	}

	public function test_forged_meta_cannot_delete_media_the_author_does_not_own(): void {
		// `_narration_attachment_id` is registered show_in_rest and authorised
		// with edit_post, so any Author can point it at the site logo over
		// /wp/v2/posts/<id> and then delete their own post. Deleting whatever it
		// named made that a permanent, unrecoverable delete of someone else's
		// file. The marker, which REST cannot write, is what makes it inert.
		$victim_id = self::factory()->attachment->create_object(
			array( 'file' => 'site-logo.png' )
		);
		$post_id   = self::factory()->post->create();
		Post_Voice_Post_Meta::save( $post_id, $victim_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		wp_delete_post( $post_id, true );

		$this->assertNotNull( get_post( $victim_id ) );
	}

	public function test_deleting_post_leaves_audio_the_author_attached_themselves(): void {
		$post_id = self::factory()->post->create();
		$own_id  = self::factory()->attachment->create_object(
			array(
				'file'        => 'interview.mp3',
				'post_parent' => $post_id,
			)
		);

		wp_delete_post( $post_id, true );

		$this->assertNotNull( get_post( $own_id ) );
	}

	/**
	 * Attach a marked narration to a post, as the REST endpoint does.
	 *
	 * @param int $post_id Post to attach it to.
	 */
	private function create_narration( int $post_id ): int {
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'narration.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::mark_attachment( $attachment_id );

		return $attachment_id;
	}

	public function test_deleting_attachment_clears_post_meta(): void {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'narration.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		wp_delete_attachment( $attachment_id, true );

		$this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
	}

	public function test_deleting_unrelated_attachment_does_not_clear_meta(): void {
		$post_id      = self::factory()->post->create();
		$narration_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'narration.mp3',
				'post_parent' => $post_id,
			)
		);
		$unrelated_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'featured.jpg',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $narration_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		wp_delete_attachment( $unrelated_id, true );

		$this->assertSame( $narration_id, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
	}
}
