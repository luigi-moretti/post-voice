<?php
/**
 * The player styling section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the style option, the live preview and the four fields.
 *
 * The preview is rendered by the section callback, which prints above the form
 * table — the author sees the player first and the controls under it, which is
 * the layout the spec's mockups settled on.
 */
class Post_Voice_Style_Section {

	private const SECTION = 'post_voice_player_style_section';

	/**
	 * Hook the setting and this screen's assets.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Register the option, the section and the four fields.
	 */
	public static function register_setting(): void {
		register_setting(
			Post_Voice_Settings_Page::OPTION_GROUP,
			Post_Voice_Style_Store::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Post_Voice_Style_Store', 'sanitize' ),
				'default'           => Post_Voice_Style_Store::DEFAULTS,
			)
		);

		add_settings_section(
			self::SECTION,
			__( 'Player', 'post-voice' ),
			array( self::class, 'render' ),
			Post_Voice_Settings_Page::MENU_SLUG
		);

		$colours = array(
			'surface' => array( __( 'Background', 'post-voice' ), __( 'Pick the background colour', 'post-voice' ) ),
			'accent'  => array( __( 'Accent', 'post-voice' ), __( 'Pick the accent colour', 'post-voice' ) ),
			'text'    => array( __( 'Text and icons', 'post-voice' ), __( 'Pick the text colour', 'post-voice' ) ),
		);

		foreach ( $colours as $key => $labels ) {
			add_settings_field(
				'post_voice_player_style_' . $key,
				$labels[0],
				array( self::class, 'render_color_field' ),
				Post_Voice_Settings_Page::MENU_SLUG,
				self::SECTION,
				array(
					'key'          => $key,
					'label_for'    => 'post-voice-style-' . $key,
					'picker_label' => $labels[1],
				)
			);
		}

		add_settings_field(
			'post_voice_player_style_radius',
			__( 'Corners', 'post-voice' ),
			array( self::class, 'render_radius_field' ),
			Post_Voice_Settings_Page::MENU_SLUG,
			self::SECTION,
			array( 'label_for' => 'post-voice-style-radius' )
		);
	}

	/**
	 * Load the preview's assets, on this screen only.
	 *
	 * The player's own stylesheet is enqueued here under the same handle it uses
	 * on the frontend: the preview is the real player, so it must be the real
	 * CSS. The admin sheet on top only undoes the fixed positioning.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( ! Post_Voice_Settings_Page::is_current_screen( (string) $hook_suffix ) ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/player-style-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_style(
			'post-voice-player',
			POST_VOICE_URL . 'build/style-narration-player.css',
			array(),
			$asset['version']
		);
		wp_enqueue_style(
			'post-voice-player-style-admin',
			POST_VOICE_URL . 'build/style-player-style-admin.css',
			array( 'post-voice-player' ),
			$asset['version']
		);
		wp_enqueue_script(
			'post-voice-player-style-admin',
			POST_VOICE_URL . 'build/player-style-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-player-style-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the preview and the contrast message.
	 */
	public static function render(): void {
		$declarations = Post_Voice_Style_Store::css_declarations();
		?>
		<p><?php esc_html_e( 'Colours for the player readers see under a narrated post.', 'post-voice' ); ?></p>
		<div class="post-voice-preview"
			<?php if ( '' !== $declarations ) : ?>
			style="<?php echo esc_attr( $declarations ); ?>"
			<?php endif; ?>
		>
			<?php
			// Built by the same function the frontend uses, so the preview cannot
			// drift from the player. Its own output is escaped at the source.
			echo Post_Voice_Frontend_Render::markup( null, true ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
			?>
		</div>
		<p class="post-voice-contrast-warning" role="status"></p>
		<?php
	}

	/**
	 * Render one colour row: a picker and the hex it posts.
	 *
	 * @param array{key: string, label_for: string, picker_label: string} $args Field arguments.
	 */
	public static function render_color_field( array $args ): void {
		$key   = (string) $args['key'];
		$value = Post_Voice_Style_Store::get()[ $key ];
		$name  = Post_Voice_Style_Store::OPTION . '[' . $key . ']';
		?>
		<input type="color"
			class="post-voice-style-picker"
			data-key="<?php echo esc_attr( $key ); ?>"
			value="<?php echo esc_attr( Post_Voice_Style_Store::expand_hex( $value ) ); ?>"
			aria-label="<?php echo esc_attr( (string) $args['picker_label'] ); ?>" />
		<input type="text"
			id="<?php echo esc_attr( (string) $args['label_for'] ); ?>"
			class="post-voice-style-hex"
			data-key="<?php echo esc_attr( $key ); ?>"
			name="<?php echo esc_attr( $name ); ?>"
			value="<?php echo esc_attr( $value ); ?>"
			pattern="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})"
			maxlength="7"
			spellcheck="false"
			autocomplete="off" />
		<?php
	}

	/**
	 * Render the corner preset select.
	 */
	public static function render_radius_field(): void {
		$labels = array(
			'pill'    => __( 'Pill (default)', 'post-voice' ),
			'rounded' => __( 'Rounded corners', 'post-voice' ),
			'square'  => __( 'Square corners', 'post-voice' ),
		);
		$value  = Post_Voice_Style_Store::get()['radius'];
		?>
		<select id="post-voice-style-radius"
			class="post-voice-style-radius"
			name="<?php echo esc_attr( Post_Voice_Style_Store::OPTION . '[radius]' ); ?>">
			<?php foreach ( $labels as $key => $label ) : ?>
			<option value="<?php echo esc_attr( $key ); ?>"
				<?php selected( $value, $key ); ?>
				data-length="<?php echo esc_attr( Post_Voice_Style_Store::RADII[ $key ] ); ?>">
				<?php echo esc_html( $label ); ?>
			</option>
			<?php endforeach; ?>
		</select>
		<?php
	}
}
