<?php
/**
 * Tests for Post_Voice_Capability_Guard.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Capability_Guard
 */
class Test_Post_Voice_Capability_Guard extends WP_UnitTestCase {

	public function test_auth_callback_requires_edit_post_capability(): void {
		$post_id = self::factory()->post->create();

		$subscriber = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $subscriber );
		$this->assertFalse( Post_Voice_Capability_Guard::auth_callback( true, '_narration_language', $post_id ) );

		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );
		$this->assertTrue( Post_Voice_Capability_Guard::auth_callback( true, '_narration_language', $post_id ) );
	}
}
