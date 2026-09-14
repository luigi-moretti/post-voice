<?php
/**
 * Tests for Post_Voice_Editor_Headers.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Editor_Headers
 */
class Test_Post_Voice_Editor_Headers extends WP_UnitTestCase {

	public function test_post_editor_screen_is_an_editor_screen(): void {
		$this->assertTrue( Post_Voice_Editor_Headers::is_editor_screen( 'post.php', 'post' ) );
	}

	public function test_new_post_screen_is_an_editor_screen(): void {
		$this->assertTrue( Post_Voice_Editor_Headers::is_editor_screen( 'post-new.php', 'post' ) );
	}

	public function test_unrelated_admin_screen_is_not_an_editor_screen(): void {
		$this->assertFalse( Post_Voice_Editor_Headers::is_editor_screen( 'edit.php', 'post' ) );
	}

	public function test_page_editor_is_not_an_editor_screen(): void {
		// Narration only ever renders for the `post` post type
		// (`Post_Voice_Assets::enqueue_editor_assets`) — a Page uses the same
		// `post.php`/`post-new.php` `$pagenow`, but must not get the headers.
		$this->assertFalse( Post_Voice_Editor_Headers::is_editor_screen( 'post.php', 'page' ) );
	}

	public function test_other_post_type_editor_is_not_an_editor_screen(): void {
		// Same reasoning for any other post type, e.g. a WooCommerce product —
		// exactly the kind of screen the issue asks to sanity-check in QA.
		$this->assertFalse( Post_Voice_Editor_Headers::is_editor_screen( 'post-new.php', 'product' ) );
	}

	public function tear_down(): void {
		delete_option( Post_Voice_Acceleration_Store::OPTION );
		remove_all_filters( 'post_voice_send_isolation_headers' );
		parent::tear_down();
	}

	public function test_headers_are_sent_on_the_editor_by_default(): void {
		$this->assertTrue( Post_Voice_Editor_Headers::should_send( 'post-new.php', 'post' ) );
	}

	public function test_headers_are_not_sent_when_the_site_turned_acceleration_off(): void {
		// The whole point of the setting: a site whose editor shows a blank
		// CodePen/YouTube embed under COEP turns this off and gets its embeds
		// back, at the cost of single-threaded generation.
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::OFF
		);

		$this->assertFalse( Post_Voice_Editor_Headers::should_send( 'post-new.php', 'post' ) );
	}

	public function test_headers_are_not_sent_off_the_editor_however_the_option_reads(): void {
		$this->assertFalse( Post_Voice_Editor_Headers::should_send( 'edit.php', 'post' ) );
	}

	public function test_the_filter_can_still_turn_the_headers_off_with_the_option_on(): void {
		// The filter predates the option and stays the last word, so a site
		// that already disabled the headers in code keeps working unchanged.
		add_filter( 'post_voice_send_isolation_headers', '__return_false' );

		$this->assertFalse( Post_Voice_Editor_Headers::should_send( 'post-new.php', 'post' ) );
	}

	public function test_the_filter_can_turn_the_headers_on_with_the_option_off(): void {
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::OFF
		);
		add_filter( 'post_voice_send_isolation_headers', '__return_true' );

		$this->assertTrue( Post_Voice_Editor_Headers::should_send( 'post-new.php', 'post' ) );
	}
}
