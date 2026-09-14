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
 *
 * Two groups of sections share this one screen, in one `<form>`, but not one
 * Save Changes: `MENU_SLUG` is for sections backed by a real option, saved by
 * the shared button. `STANDALONE_SLUG` is for a section that persists itself
 * — nothing here writes an option, so a shared Save Changes next to it would
 * be misleading (`docs/superpowers/specs/2026-09-12-model-management-screen-design.md`
 * is the first case: the Models section writes straight to the browser's
 * Cache API). A standalone section is free to render its own save control
 * inside its own callback if it ever needs one — this split only decides
 * which sections don't share the button the `MENU_SLUG` group renders.
 */
class Post_Voice_Settings_Page {

	public const MENU_SLUG       = 'post-voice';
	public const STANDALONE_SLUG = self::MENU_SLUG . '-standalone';
	public const OPTION_GROUP    = 'post_voice_settings';

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
	 *
	 * Save Changes sits right after the `MENU_SLUG` sections it actually
	 * applies to, not at the very end of the page — a section from
	 * `STANDALONE_SLUG` below it persists on its own, and a shared button
	 * appearing to also cover that section's changes would be wrong. The
	 * divider between them only prints when there is something standalone
	 * to divide from.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		global $wp_settings_sections;
		$has_standalone = ! empty( $wp_settings_sections[ self::STANDALONE_SLUG ] );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Narration', 'post-voice' ); ?></h1>
			<form method="post" action="options.php">
				<?php
				settings_fields( self::OPTION_GROUP );
				do_settings_sections( self::MENU_SLUG );
				submit_button();
				if ( $has_standalone ) {
					echo '<hr />';
				}
				do_settings_sections( self::STANDALONE_SLUG );
				?>
			</form>
		</div>
		<?php
	}
}
