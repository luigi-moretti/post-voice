<?php
/**
 * Tests for Post_Voice_Assets.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Assets
 */
class Test_Post_Voice_Assets extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();
		Post_Voice_Assets::register();

		// Enqueued handles are global and survive between tests, so a later test
		// would see whatever an earlier one enqueued and pass (or fail) for the
		// wrong reason.
		$GLOBALS['wp_scripts'] = new WP_Scripts();
		$GLOBALS['wp_styles']  = new WP_Styles();
	}

	public function test_frontend_assets_enqueued_only_when_post_has_narration(): void {
		$post_id = self::factory()->post->create();
		$this->go_to( get_permalink( $post_id ) );

		Post_Voice_Assets::enqueue_frontend_assets();
		$this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );

		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', 'alba', str_repeat( 'a', 64 ) );

		Post_Voice_Assets::enqueue_frontend_assets();
		$this->assertTrue( wp_script_is( 'post-voice-player', 'enqueued' ) );
	}

	public function test_frontend_assets_not_enqueued_on_non_singular_pages(): void {
		$this->go_to( home_url( '/' ) );
		Post_Voice_Assets::enqueue_frontend_assets();
		$this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );
	}
}
