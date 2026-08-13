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

	public function test_editor_assets_enqueued_on_the_post_editor(): void {
		set_current_screen( 'post' );
		$this->with_editor_asset_file();

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
		$this->with_editor_asset_file();

		Post_Voice_Assets::enqueue_editor_assets();

		$this->assertFalse( wp_script_is( 'post-voice-editor', 'enqueued' ) );
	}

	public function test_editor_assets_skipped_when_the_plugin_was_never_built(): void {
		set_current_screen( 'post' );
		// A plugin copied to a server without running the build. Enqueuing anyway
		// would 404 and leave the editor with a panel that never renders.
		$this->without_editor_asset_file();

		Post_Voice_Assets::enqueue_editor_assets();

		$this->assertFalse( wp_script_is( 'post-voice-editor', 'enqueued' ) );
	}

	/**
	 * Path of the build's asset manifest.
	 */
	private function asset_file(): string {
		return POST_VOICE_PATH . 'build/narration-editor.asset.php';
	}

	/**
	 * Guarantee the asset manifest exists.
	 *
	 * Written to disk rather than mocked because the class reads it with
	 * `require`. CI's unit job never runs the build, and a developer's working
	 * copy usually has one, so both directions have to be arranged explicitly.
	 */
	private function with_editor_asset_file(): void {
		if ( file_exists( $this->asset_file() ) ) {
			return;
		}

		if ( ! is_dir( dirname( $this->asset_file() ) ) ) {
			mkdir( dirname( $this->asset_file() ), 0777, true );
		}
		file_put_contents(
			$this->asset_file(),
			"<?php return array( 'dependencies' => array( 'wp-element' ), 'version' => 'test' );\n"
		);
		$this->fabricated_asset_file = true;
	}

	/**
	 * Guarantee the asset manifest is absent, restoring a real one afterwards.
	 */
	private function without_editor_asset_file(): void {
		if ( ! file_exists( $this->asset_file() ) ) {
			return;
		}

		rename( $this->asset_file(), $this->asset_file() . '.testbak' );
		$this->hidden_asset_file = true;
	}

	public function tear_down(): void {
		if ( $this->fabricated_asset_file ) {
			unlink( $this->asset_file() );
			$this->fabricated_asset_file = false;
		}
		if ( $this->hidden_asset_file ) {
			rename( $this->asset_file() . '.testbak', $this->asset_file() );
			$this->hidden_asset_file = false;
		}
		parent::tear_down();
	}

	/**
	 * Whether this test wrote a stand-in asset file that must be removed.
	 *
	 * @var bool
	 */
	private bool $fabricated_asset_file = false;

	/**
	 * Whether this test moved a real asset file aside that must be restored.
	 *
	 * @var bool
	 */
	private bool $hidden_asset_file = false;
}
