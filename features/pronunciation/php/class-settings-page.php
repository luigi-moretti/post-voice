<?php
/**
 * Site-wide pronunciation dictionary screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * `Settings → Narration`: the site dictionary, plus the home for Fase 3's
 * player styling.
 *
 * A plain settings page rather than the Customizer or Global Styles: the
 * per-site values here are not theme concerns, and tying them to `theme.json`
 * would tie the plugin to whatever the active theme supports.
 */
class Post_Voice_Settings_Page {

	public const MENU_SLUG     = 'post-voice';
	private const OPTION_GROUP = 'post_voice_settings';

	/**
	 * Hook the menu, the setting and the screen's own script.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'add_page' ) );
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
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
	 * Register the dictionary option against the store's sanitiser.
	 */
	public static function register_setting(): void {
		register_setting(
			self::OPTION_GROUP,
			Post_Voice_Dictionary_Store::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
				'default'           => array(),
			)
		);
	}

	/**
	 * Load the row-editing script, on this screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( 'settings_page_' . self::MENU_SLUG !== $hook_suffix ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/dictionary-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_script(
			'post-voice-dictionary-admin',
			POST_VOICE_URL . 'build/dictionary-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-dictionary-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the screen.
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$entries   = Post_Voice_Dictionary_Store::get_global();
		$languages = Post_Voice_Rest_Api::ALLOWED_LANGUAGES;
		$option    = Post_Voice_Dictionary_Store::OPTION;
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Narration', 'post-voice' ); ?></h1>
			<h2><?php esc_html_e( 'Pronunciation dictionary', 'post-voice' ); ?></h2>
			<p>
				<?php
				esc_html_e(
					'Read a term aloud as something else. Entries apply to the language you choose, because a respelling is phonetic: the same correction read by another language model is a new mistake.',
					'post-voice'
				);
				?>
			</p>
			<form method="post" action="options.php">
				<?php settings_fields( self::OPTION_GROUP ); ?>
				<table class="widefat striped" id="post-voice-dictionary">
					<thead>
						<tr>
							<th scope="col"><?php esc_html_e( 'Term', 'post-voice' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Read as', 'post-voice' ); ?></th>
							<th scope="col"><?php esc_html_e( 'Language', 'post-voice' ); ?></th>
							<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'post-voice' ); ?></span></th>
						</tr>
					</thead>
					<tbody>
						<?php foreach ( $entries as $index => $entry ) : ?>
						<tr>
							<td>
								<input type="text" name="<?php echo esc_attr( $option . '[' . $index . '][term]' ); ?>"
									value="<?php echo esc_attr( $entry['term'] ); ?>"
									maxlength="<?php echo esc_attr( (string) Post_Voice_Dictionary_Store::MAX_TERM_LENGTH ); ?>"
									aria-label="<?php esc_attr_e( 'Term', 'post-voice' ); ?>" />
							</td>
							<td>
								<input type="text" name="<?php echo esc_attr( $option . '[' . $index . '][replacement]' ); ?>"
									value="<?php echo esc_attr( $entry['replacement'] ); ?>"
									maxlength="<?php echo esc_attr( (string) Post_Voice_Dictionary_Store::MAX_REPLACEMENT_LENGTH ); ?>"
									aria-label="<?php esc_attr_e( 'Read as', 'post-voice' ); ?>" />
							</td>
							<td>
								<select name="<?php echo esc_attr( $option . '[' . $index . '][language]' ); ?>"
									aria-label="<?php esc_attr_e( 'Language', 'post-voice' ); ?>">
									<?php foreach ( $languages as $language ) : ?>
									<option value="<?php echo esc_attr( $language ); ?>" <?php selected( $entry['language'], $language ); ?>>
										<?php echo esc_html( $language ); ?>
									</option>
									<?php endforeach; ?>
								</select>
							</td>
							<td>
								<button type="button" class="button-link post-voice-remove-row">
									<?php esc_html_e( 'Remove', 'post-voice' ); ?>
								</button>
							</td>
						</tr>
						<?php endforeach; ?>
					</tbody>
				</table>
				<p>
					<button type="button" class="button" id="post-voice-add-row"
						data-option="<?php echo esc_attr( $option ); ?>"
						data-next-index="<?php echo esc_attr( (string) count( $entries ) ); ?>"
						data-languages="<?php echo esc_attr( (string) wp_json_encode( $languages ) ); ?>">
						<?php esc_html_e( 'Add entry', 'post-voice' ); ?>
					</button>
				</p>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
