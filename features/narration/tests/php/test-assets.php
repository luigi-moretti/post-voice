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

	use Post_Voice_With_Asset_File;

	public function set_up(): void {
		parent::set_up();
		Post_Voice_Assets::register();

		// Enqueued handles are global and survive between tests, so a later test
		// would see whatever an earlier one enqueued and pass (or fail) for the
		// wrong reason.
		$GLOBALS['wp_scripts'] = new WP_Scripts();
		$GLOBALS['wp_styles']  = new WP_Styles();

		foreach ( array( 'editor', 'player' ) as $entry ) {
			$this->recover_parked_asset_file( $this->asset_file( $entry ) );
		}
	}

	public function test_frontend_assets_enqueued_only_when_post_has_narration(): void {
		$this->with_asset_file( $this->asset_file( 'player' ) );
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
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		Post_Voice_Assets::enqueue_frontend_assets();
		$this->assertTrue( wp_script_is( 'post-voice-player', 'enqueued' ) );
	}

	public function test_no_inline_style_when_the_player_was_never_customised(): void {
		$this->with_asset_file( $this->asset_file( 'player' ) );
		delete_option( Post_Voice_Style_Store::OPTION );
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		$this->go_to( get_permalink( $post_id ) );
		Post_Voice_Assets::enqueue_frontend_assets();

		// `get_data()` returns `false`, not an empty array, when `wp_add_inline_style`
		// was never called for the handle — WP_Dependencies never sets the `after`
		// key at registration time.
		$this->assertFalse( wp_styles()->get_data( 'post-voice-player', 'after' ) );
	}

	public function test_customised_player_ships_its_declarations_inline(): void {
		$this->with_asset_file( $this->asset_file( 'player' ) );
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'accent' => '#c00000' ) + Post_Voice_Style_Store::DEFAULTS
		);
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );

		$this->go_to( get_permalink( $post_id ) );
		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertContains(
			'.post-voice-player{--pv-accent:#c00000}',
			(array) wp_styles()->get_data( 'post-voice-player', 'after' )
		);
	}

	public function test_frontend_assets_not_enqueued_on_non_singular_pages(): void {
		$this->go_to( home_url( '/' ) );
		Post_Voice_Assets::enqueue_frontend_assets();
		$this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );
	}

	public function test_frontend_assets_skipped_when_the_plugin_was_never_built(): void {
		// Without the guard this 404s two files on every narrated post, on the
		// reader's side, where nobody would think to look for a build problem.
		$this->without_asset_file( $this->asset_file( 'player' ) );
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );
		$this->go_to( get_permalink( $post_id ) );

		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );
	}

	public function test_editor_assets_enqueued_on_the_post_editor(): void {
		set_current_screen( 'post' );
		$this->with_asset_file( $this->asset_file() );

		Post_Voice_Assets::enqueue_editor_assets();

		$this->assertTrue( wp_script_is( 'post-voice-editor', 'enqueued' ) );
		$this->assertTrue( wp_style_is( 'post-voice-editor', 'enqueued' ) );

		// The panel is React and i18n'd; without its dependencies WordPress would
		// load it before wp-element exists, and without the translations call the
		// .pot this project generates would never reach the browser.
		$script = wp_scripts()->registered['post-voice-editor'];
		$this->assertContains( 'wp-element', $script->deps );
		$this->assertSame( 'post-voice', $script->textdomain );
	}

	public function test_editor_assets_not_enqueued_on_other_post_types(): void {
		set_current_screen( 'page' );
		$this->with_asset_file( $this->asset_file() );

		Post_Voice_Assets::enqueue_editor_assets();

		$this->assertFalse( wp_script_is( 'post-voice-editor', 'enqueued' ) );
	}

	public function test_editor_assets_skipped_when_the_plugin_was_never_built(): void {
		set_current_screen( 'post' );
		// A plugin copied to a server without running the build. Enqueuing anyway
		// would 404 and leave the editor with a panel that never renders.
		$this->without_asset_file( $this->asset_file() );

		Post_Voice_Assets::enqueue_editor_assets();

		$this->assertFalse( wp_script_is( 'post-voice-editor', 'enqueued' ) );
	}

	public function test_editor_assets_localise_the_global_dictionary(): void {
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'portuguese',
				),
			)
		);
		set_current_screen( 'post' );
		$this->with_asset_file( $this->asset_file() );

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'Bi Iou Di', $data );
	}

	public function test_editor_assets_localise_the_site_language(): void {
		set_current_screen( 'post' );
		$this->with_asset_file( $this->asset_file() );

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'siteLanguage', $data );
		$this->assertStringContainsString( get_locale(), $data );
	}

	public function test_editor_assets_localise_can_manage_options(): void {
		set_current_screen( 'post' );
		$this->with_asset_file( $this->asset_file() );

		// Test as administrator — should have manage_options capability.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'canManageOptions', $data );
		$this->assertStringContainsString( '"canManageOptions":"1"', $data );

		// Reset scripts to test again.
		$GLOBALS['wp_scripts'] = new WP_Scripts();

		// Test as subscriber — should not have manage_options capability.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'canManageOptions', $data );
		// wp_localize_script converts false to empty string in JSON.
		$this->assertStringContainsString( '"canManageOptions":""', $data );
	}

	public function test_dictionary_provider_can_be_swapped_and_is_restored(): void {
		set_current_screen( 'post' );
		$this->with_asset_file( $this->asset_file() );

		$original = array( 'Post_Voice_Dictionary_Store', 'get_global' );
		Post_Voice_Assets::set_dictionary_provider(
			static function (): array {
				return array(
					array(
						'term'        => 'stub',
						'replacement' => 'STUB',
						'language'    => 'portuguese',
					),
				);
			}
		);

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'STUB', $data );

		Post_Voice_Assets::set_dictionary_provider( $original );
	}

	public function test_style_provider_can_be_swapped_and_is_restored(): void {
		$this->with_asset_file( $this->asset_file( 'player' ) );
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', array( 'portuguese' ), 'alba', str_repeat( 'a', 64 ) );
		$this->go_to( get_permalink( $post_id ) );

		$original = array( 'Post_Voice_Style_Store', 'inline_css' );
		Post_Voice_Assets::set_style_provider(
			static function (): string {
				return '.post-voice-player{--stub:1}';
			}
		);

		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertContains(
			'.post-voice-player{--stub:1}',
			(array) wp_styles()->get_data( 'post-voice-player', 'after' )
		);

		Post_Voice_Assets::set_style_provider( $original );
	}

	/**
	 * Path of a build entry's asset manifest.
	 *
	 * @param string $entry Entry name, `editor` or `player`.
	 */
	private function asset_file( string $entry = 'editor' ): string {
		return POST_VOICE_PATH . "build/narration-{$entry}.asset.php";
	}

	public function tear_down(): void {
		$this->tear_down_asset_files();
		parent::tear_down();
	}
}
