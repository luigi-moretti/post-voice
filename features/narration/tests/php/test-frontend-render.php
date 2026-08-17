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

	public function test_markup_in_preview_mode_is_the_enhanced_player_without_audio(): void {
		$html = Post_Voice_Frontend_Render::markup( null, true );

		$this->assertStringContainsString( 'post-voice-player--enhanced', $html );
		$this->assertStringNotContainsString( '<audio', $html );
		$this->assertStringNotContainsString( 'aria-live', $html );
		$this->assertStringNotContainsString( 'role="region"', $html );
	}

	public function test_preview_controls_are_disabled_rather_than_hidden(): void {
		$html = Post_Voice_Frontend_Render::markup( null, true );

		foreach ( array( 'play', 'rate', 'close' ) as $role ) {
			$this->assertMatchesRegularExpression(
				'/<button[^>]*data-role="' . $role . '"[^>]*\sdisabled/',
				$html,
				"The preview's {$role} button should be disabled."
			);
		}
		// `aria-hidden` on a block containing focusable controls is an axe
		// violation, so the preview disables them instead.
		$this->assertStringNotContainsString( ' hidden', $html );
	}

	public function test_preview_shows_the_progress_bar_partly_filled(): void {
		$html = Post_Voice_Frontend_Render::markup( null, true );

		$this->assertMatchesRegularExpression(
			'/<input[^>]*data-role="seek"[^>]*value="40"/',
			$html
		);
	}

	public function test_frontend_markup_keeps_the_audio_element_and_the_region(): void {
		$html = Post_Voice_Frontend_Render::markup( 'https://example.com/n.mp3' );

		$this->assertStringContainsString( '<audio controls src="https://example.com/n.mp3"', $html );
		$this->assertStringContainsString( 'role="region"', $html );
		$this->assertStringNotContainsString( 'post-voice-player--enhanced', $html );
		$this->assertStringNotContainsString( 'disabled', $html );
	}
}
