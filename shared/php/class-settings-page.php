<?php
/**
 * The plugin's settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * `Settings → Narration`: a shell that renders whatever sections the features
 * registered.
 *
 * A plain settings page rather than the Customizer or Global Styles: the
 * per-site values here are not theme concerns, and tying them to `theme.json`
 * would tie the plugin to whatever the active theme supports.
 *
 * This class owns no field and no option. Each feature registers its own
 * section against `OPTION_GROUP` and `MENU_SLUG`, so the screen grows without
 * this file changing, and one feature's absence cannot take the screen down.
 */
class Post_Voice_Settings_Page {

	public const MENU_SLUG    = 'post-voice';
	public const OPTION_GROUP = 'post_voice_settings';

	/**
	 * Hook the menu.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'add_page' ) );
	}

	/**
	 * Add the options page.
	 */
	public static function add_page(): void {
		add_options_page(
			__( 'Narration', 'post-voice' ),
			__( 'Narration', 'post-voice' ),
			'manage_options',
			self::MENU_SLUG,
			array( self::class, 'render' )
		);
	}

	/**
	 * Whether the given admin screen is this one.
	 *
	 * Exposed so each section can guard its own `admin_enqueue_scripts` without
	 * copying the hook suffix, which would then have two places to be wrong.
	 *
	 * @param string $hook_suffix Current admin page, as passed to the hook.
	 */
	public static function is_current_screen( string $hook_suffix ): bool {
		return 'settings_page_' . self::MENU_SLUG === $hook_suffix;
	}

	/**
	 * Render the screen.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Narration', 'post-voice' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( self::OPTION_GROUP );
				do_settings_sections( self::MENU_SLUG );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
