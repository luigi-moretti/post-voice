<?php
/**
 * Tests for Post_Voice_Post_Meta.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Post_Meta
 */
class Test_Post_Voice_Post_Meta extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();
		// WP_UnitTestCase unregisters every meta key between tests, so the
		// plugin's own `init` registration from bootstrap does not survive.
		Post_Voice_Post_Meta::register();
	}

	public function test_save_writes_all_four_meta_keys(): void {
		$post_id = self::factory()->post->create();
		Post_Voice_Post_Meta::save( $post_id, 42, 'portuguese', 'alba', str_repeat( 'a', 64 ) );

		$this->assertSame( 42, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
		$this->assertSame( 'portuguese', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
		$this->assertSame( 'alba', get_post_meta( $post_id, Post_Voice_Post_Meta::VOICE, true ) );
		$this->assertSame( str_repeat( 'a', 64 ), get_post_meta( $post_id, Post_Voice_Post_Meta::SOURCE_HASH, true ) );
	}

	public function test_clear_removes_all_four_meta_keys(): void {
		$post_id = self::factory()->post->create();
		Post_Voice_Post_Meta::save( $post_id, 42, 'portuguese', 'alba', str_repeat( 'a', 64 ) );

		Post_Voice_Post_Meta::clear( $post_id );

		$this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::VOICE, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::SOURCE_HASH, true ) );
	}

	public function test_auth_callback_requires_edit_post_capability(): void {
		$post_id = self::factory()->post->create();

		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->assertFalse( Post_Voice_Post_Meta::auth_callback( true, Post_Voice_Post_Meta::LANGUAGE, $post_id ) );

		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );
		$this->assertTrue( Post_Voice_Post_Meta::auth_callback( true, Post_Voice_Post_Meta::LANGUAGE, $post_id ) );
	}

	public function test_marking_an_attachment_claims_it_as_a_narration(): void {
		$attachment_id = self::factory()->attachment->create_object(
			array( 'file' => 'n.mp3' )
		);

		$this->assertSame( '', get_post_meta( $attachment_id, Post_Voice_Post_Meta::ATTACHMENT_MARKER, true ) );

		Post_Voice_Post_Meta::mark_attachment( $attachment_id );

		$this->assertSame( '1', get_post_meta( $attachment_id, Post_Voice_Post_Meta::ATTACHMENT_MARKER, true ) );
	}

	public function test_lists_only_marked_attachments_of_the_post_oldest_first(): void {
		$post_id  = self::factory()->post->create();
		$other_id = self::factory()->post->create();

		$first  = $this->create_narration( $post_id );
		$second = $this->create_narration( $post_id );

		// Audio the author attached themselves: same post, no marker. The sweep
		// deletes whatever this returns, so a miss here destroys the author's file.
		self::factory()->attachment->create_object(
			array(
				'file'        => 'interview.mp3',
				'post_parent' => $post_id,
			)
		);

		// A narration on a different post, to prove the query is scoped.
		$this->create_narration( $other_id );

		$this->assertSame(
			array( $first, $second ),
			Post_Voice_Post_Meta::get_narration_attachment_ids( $post_id )
		);
	}

	public function test_lists_nothing_for_a_post_without_narration(): void {
		$post_id = self::factory()->post->create();

		$this->assertSame( array(), Post_Voice_Post_Meta::get_narration_attachment_ids( $post_id ) );
	}

	/**
	 * Attach a marked narration to a post, as the REST endpoint would.
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

	public function test_meta_keys_are_registered_for_the_post_type(): void {
		$registered = get_registered_meta_keys( 'post', 'post' );

		$this->assertArrayHasKey( Post_Voice_Post_Meta::ATTACHMENT_ID, $registered );
		$this->assertArrayHasKey( Post_Voice_Post_Meta::LANGUAGE, $registered );
		$this->assertArrayHasKey( Post_Voice_Post_Meta::VOICE, $registered );
		$this->assertArrayHasKey( Post_Voice_Post_Meta::SOURCE_HASH, $registered );
		$this->assertTrue( $registered[ Post_Voice_Post_Meta::ATTACHMENT_ID ]['show_in_rest'] );
	}
}
