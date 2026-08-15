<?php
/**
 * Tests for Post_Voice_Frontend_Render.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Frontend_Render
 */
class Test_Post_Voice_Frontend_Render extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();
		Post_Voice_Frontend_Render::register();
	}

	public function test_appends_player_markup_when_post_has_narration(): void {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		$this->go_to( get_permalink( $post_id ) );
		the_post();

		$output = Post_Voice_Frontend_Render::append_player( 'Original content.' );

		$this->assertStringContainsString( 'Original content.', $output );
		$this->assertStringContainsString( 'post-voice-player', $output );
		$this->assertStringContainsString( '<audio controls', $output );
	}

	public function test_enhancement_controls_ship_hidden_for_the_no_js_case(): void {
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		$this->go_to( get_permalink( $post_id ) );
		the_post();

		$output = Post_Voice_Frontend_Render::append_player( 'Original content.' );

		// Only player.ts gives these buttons behaviour, so without JavaScript they
		// would render as controls that look operable and do nothing. The native
		// <audio controls> is the no-JS experience.
		foreach ( array( 'play', 'rate', 'close' ) as $role ) {
			$this->assertMatchesRegularExpression(
				'/<button[^>]*data-role="' . $role . '"[^>]*\shidden/',
				$output,
				"The {$role} control must ship hidden."
			);
		}
	}

	public function test_does_not_append_player_when_post_has_no_narration(): void {
		$post_id = self::factory()->post->create();

		$this->go_to( get_permalink( $post_id ) );
		the_post();

		$output = Post_Voice_Frontend_Render::append_player( 'Original content.' );

		$this->assertSame( 'Original content.', $output );
	}
}
