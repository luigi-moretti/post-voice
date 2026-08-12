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

	public function test_save_writes_all_three_meta_keys(): void {
		$post_id = self::factory()->post->create();
		Post_Voice_Post_Meta::save( $post_id, 42, 'portuguese', str_repeat( 'a', 64 ) );

		$this->assertSame( 42, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
		$this->assertSame( 'portuguese', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
		$this->assertSame( str_repeat( 'a', 64 ), get_post_meta( $post_id, Post_Voice_Post_Meta::SOURCE_HASH, true ) );
	}

	public function test_clear_removes_all_three_meta_keys(): void {
		$post_id = self::factory()->post->create();
		Post_Voice_Post_Meta::save( $post_id, 42, 'portuguese', str_repeat( 'a', 64 ) );

		Post_Voice_Post_Meta::clear( $post_id );

		$this->assertSame( 0, Post_Voice_Post_Meta::get_attachment_id( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, Post_Voice_Post_Meta::LANGUAGE, true ) );
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

	public function test_meta_keys_are_registered_for_the_post_type(): void {
		$registered = get_registered_meta_keys( 'post', 'post' );

		$this->assertArrayHasKey( Post_Voice_Post_Meta::ATTACHMENT_ID, $registered );
		$this->assertArrayHasKey( Post_Voice_Post_Meta::LANGUAGE, $registered );
		$this->assertArrayHasKey( Post_Voice_Post_Meta::SOURCE_HASH, $registered );
		$this->assertTrue( $registered[ Post_Voice_Post_Meta::ATTACHMENT_ID ]['show_in_rest'] );
	}
}
