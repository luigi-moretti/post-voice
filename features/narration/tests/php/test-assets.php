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

		// A run killed between the rename and tear_down leaves the real manifest
		// parked at .testbak, and every later run then tests a build that looks
		// missing. Cost of not doing this: a mystery failure that survives until
		// someone notices a stray file. Cost of doing it: one stat per entry.
		foreach ( array( 'editor', 'player' ) as $entry ) {
			$parked = $this->asset_file( $entry ) . '.testbak';
			if ( file_exists( $parked ) && ! file_exists( $this->asset_file( $entry ) ) ) {
				rename( $parked, $this->asset_file( $entry ) );
			}
		}
	}

	public function test_frontend_assets_enqueued_only_when_post_has_narration(): void {
		$this->with_asset_file( 'player' );
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

	public function test_frontend_assets_skipped_when_the_plugin_was_never_built(): void {
		// Without the guard this 404s two files on every narrated post, on the
		// reader's side, where nobody would think to look for a build problem.
		$this->without_asset_file( 'player' );
		$post_id       = self::factory()->post->create();
		$attachment_id = self::factory()->attachment->create_object(
			array(
				'file'        => 'n.mp3',
				'post_parent' => $post_id,
			)
		);
		Post_Voice_Post_Meta::save( $post_id, $attachment_id, 'portuguese', 'alba', str_repeat( 'a', 64 ) );
		$this->go_to( get_permalink( $post_id ) );

		Post_Voice_Assets::enqueue_frontend_assets();

		$this->assertFalse( wp_script_is( 'post-voice-player', 'enqueued' ) );
	}

	public function test_editor_assets_enqueued_on_the_post_editor(): void {
		set_current_screen( 'post' );
		$this->with_asset_file();

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
		$this->with_asset_file();

		Post_Voice_Assets::enqueue_editor_assets();

		$this->assertFalse( wp_script_is( 'post-voice-editor', 'enqueued' ) );
	}

	public function test_editor_assets_skipped_when_the_plugin_was_never_built(): void {
		set_current_screen( 'post' );
		// A plugin copied to a server without running the build. Enqueuing anyway
		// would 404 and leave the editor with a panel that never renders.
		$this->without_asset_file();

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
		$this->with_asset_file();

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'Bi Iou Di', $data );
	}

	public function test_editor_assets_localise_the_site_language(): void {
		set_current_screen( 'post' );
		$this->with_asset_file();

		Post_Voice_Assets::enqueue_editor_assets();
		$data = wp_scripts()->get_data( 'post-voice-editor', 'data' );

		$this->assertIsString( $data );
		$this->assertStringContainsString( 'siteLanguage', $data );
		$this->assertStringContainsString( get_locale(), $data );
	}

	public function test_editor_assets_localise_can_manage_options(): void {
		set_current_screen( 'post' );
		$this->with_asset_file();

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

	/**
	 * Path of a build entry's asset manifest.
	 *
	 * @param string $entry Entry name, `editor` or `player`.
	 */
	private function asset_file( string $entry = 'editor' ): string {
		return POST_VOICE_PATH . "build/narration-{$entry}.asset.php";
	}

	/**
	 * Guarantee the asset manifest exists.
	 *
	 * Written to disk rather than mocked because the class reads it with
	 * `require`. CI's unit job never runs the build, and a developer's working
	 * copy usually has one, so both directions have to be arranged explicitly.
	 *
	 * @param string $entry Entry name, `editor` or `player`.
	 */
	private function with_asset_file( string $entry = 'editor' ): void {
		if ( file_exists( $this->asset_file( $entry ) ) ) {
			return;
		}

		if ( ! is_dir( dirname( $this->asset_file( $entry ) ) ) ) {
			mkdir( dirname( $this->asset_file( $entry ) ), 0777, true );
		}
		file_put_contents(
			$this->asset_file( $entry ),
			"<?php return array( 'dependencies' => array( 'wp-element' ), 'version' => 'test' );\n"
		);
		$this->fabricated_asset_files[] = $entry;
	}

	/**
	 * Guarantee the asset manifest is absent, restoring a real one afterwards.
	 *
	 * @param string $entry Entry name, `editor` or `player`.
	 */
	private function without_asset_file( string $entry = 'editor' ): void {
		if ( ! file_exists( $this->asset_file( $entry ) ) ) {
			return;
		}

		rename( $this->asset_file( $entry ), $this->asset_file( $entry ) . '.testbak' );
		$this->hidden_asset_files[] = $entry;
	}

	public function tear_down(): void {
		foreach ( $this->fabricated_asset_files as $entry ) {
			unlink( $this->asset_file( $entry ) );
		}
		$this->fabricated_asset_files = array();

		foreach ( $this->hidden_asset_files as $entry ) {
			rename( $this->asset_file( $entry ) . '.testbak', $this->asset_file( $entry ) );
		}
		$this->hidden_asset_files = array();

		parent::tear_down();
	}

	/**
	 * Entries this test wrote a stand-in asset file for, to be removed again.
	 *
	 * @var string[]
	 */
	private array $fabricated_asset_files = array();

	/**
	 * Entries this test moved a real asset file aside for, to be restored.
	 *
	 * @var string[]
	 */
	private array $hidden_asset_files = array();
}
