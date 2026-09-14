<?php
/**
 * The generation performance section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * One checkbox, for one trade-off the site has to own.
 *
 * Multi-threaded generation needs the post editor to be cross-origin
 * isolated, and isolation blocks any cross-origin iframe whose own response
 * carries no `Cross-Origin-Embedder-Policy` — a CodePen or YouTube embed
 * block renders blank in the editor while it is on. Neither side can be
 * detected from here (a blocked frame is opaque and logs nothing), so the
 * choice is the site's, not a heuristic's.
 *
 * The control is deliberately not phrased in terms of threads or isolation:
 * ticking it cannot promise multi-threading (that also needs the browser and
 * the host to cooperate), and the author's real question is whether they want
 * fast generation or working embed previews.
 */
class Post_Voice_Acceleration_Section {

	private const SECTION = 'post_voice_acceleration_section';

	/**
	 * Hook the setting.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
	}

	/**
	 * Register the option, the section and its single field.
	 */
	public static function register_setting(): void {
		register_setting(
			Post_Voice_Settings_Page::OPTION_GROUP,
			Post_Voice_Acceleration_Store::OPTION,
			array(
				'type'              => 'string',
				'sanitize_callback' => array( 'Post_Voice_Acceleration_Store', 'sanitize' ),
				'default'           => Post_Voice_Acceleration_Store::DEFAULT_STORED,
			)
		);

		add_settings_section(
			self::SECTION,
			__( 'Performance', 'post-voice' ),
			'__return_false',
			Post_Voice_Settings_Page::MENU_SLUG
		);

		add_settings_field(
			Post_Voice_Acceleration_Store::OPTION,
			__( 'Generation speed', 'post-voice' ),
			array( self::class, 'render_field' ),
			Post_Voice_Settings_Page::MENU_SLUG,
			self::SECTION
			// No `label_for`: core would wrap the row title in a second
			// `<label for>` pointing at the same checkbox, and every label
			// associated with a control is concatenated into its accessible
			// name — a screen reader would read "Generation speed Generate
			// narration faster, checkbox". The control carries its own label
			// below, which is the one that describes what ticking it does.
		);
	}

	/**
	 * Render the checkbox and the trade-off it stands for.
	 */
	public static function render_field(): void {
		?>
		<label for="post-voice-acceleration">
			<input type="checkbox"
				id="post-voice-acceleration"
				name="<?php echo esc_attr( Post_Voice_Acceleration_Store::OPTION ); ?>"
				value="<?php echo esc_attr( Post_Voice_Acceleration_Store::ON ); ?>"
				<?php checked( Post_Voice_Acceleration_Store::is_enabled() ); ?>
			/>
			<?php esc_html_e( 'Generate narration faster', 'post-voice' ); ?>
		</label>
		<p class="description">
			<?php
			esc_html_e(
				'Uses every core your processor has, which can make generation several times faster. While it is on, embeds from other sites (a CodePen pen, for example) can appear blank in the post editor — your published posts and your visitors are never affected. Turn it off if that happens: narration keeps working, just more slowly.',
				'post-voice'
			);
			?>
		</p>
		<p class="description">
			<?php esc_html_e( 'Takes effect the next time you open a post editor.', 'post-voice' ); ?>
		</p>
		<?php
	}
}
