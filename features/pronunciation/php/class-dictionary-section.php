<?php
/**
 * The pronunciation dictionary's section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the site dictionary's option, its section and its script.
 *
 * The whole dictionary is one wide table rather than a set of labelled fields,
 * so it is rendered by the section callback — which prints above the form
 * table — instead of through `add_settings_field()`.
 */
class Post_Voice_Dictionary_Section {

	private const SECTION = 'post_voice_dictionary_section';

	/**
	 * Hook the setting, the section and this screen's script.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_setting' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Register the option against the store's sanitiser, plus the section.
	 */
	public static function register_setting(): void {
		register_setting(
			Post_Voice_Settings_Page::OPTION_GROUP,
			Post_Voice_Dictionary_Store::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( 'Post_Voice_Dictionary_Store', 'sanitize' ),
				'default'           => array(),
			)
		);

		add_settings_section(
			self::SECTION,
			__( 'Pronunciation dictionary', 'post-voice' ),
			array( self::class, 'render' ),
			Post_Voice_Settings_Page::MENU_SLUG
		);
	}

	/**
	 * Load the row-editing script, on this screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( ! Post_Voice_Settings_Page::is_current_screen( (string) $hook_suffix ) ) {
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
	 * Render the dictionary table.
	 */
	public static function render(): void {
		$entries   = Post_Voice_Dictionary_Store::get_global();
		$languages = Post_Voice_Model::ALLOWED_LANGUAGES;
		$option    = Post_Voice_Dictionary_Store::OPTION;
		?>
		<p>
			<?php
			esc_html_e(
				'Read a term aloud as something else. Entries apply to the language you choose, because a respelling is phonetic: the same correction read by another language model is a new mistake.',
				'post-voice'
			);
			?>
		</p>
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
		<?php
	}
}
