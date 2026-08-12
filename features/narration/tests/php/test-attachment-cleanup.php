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
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'narration.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', str_repeat( 'a', 64 ) );

		wp_delete_post( $post_id, true );

		$this->assertNull( get_post( $attachment_id ) );
	}

	public function test_deleting_attachment_clears_post_meta(): void {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'narration.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', str_repeat( 'a', 64 ) );

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
		Post_Voice_Post_Meta::save( $post_id, $narration_id, 'portuguese', str_repeat( 'a', 64 ) );

		wp_delete_attachment( $unrelated_id, true );

		$this->assertSame( $narration_id, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
	}
}
