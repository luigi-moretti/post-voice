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
}
