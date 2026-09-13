<?php
/**
 * The model management section of the settings screen.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Lists the five Pocket TTS language bundles and lets the author download or
 * remove each one. No option is registered here — nothing on this screen is
 * persisted server-side; what is "downloaded" lives entirely in the
 * browser's own Cache API (see the design doc this implements). The table's
 * Status/Tamanho/Ações cells render as neutral placeholders and are filled
 * in by `models-admin.js`, which is the only thing that can answer "is this
 * downloaded" — the server never knows.
 */
class Post_Voice_Models_Section {

	private const SECTION = 'post_voice_models_section';

	/**
	 * The predefined voices every Pocket TTS bundle ships, identical in
	 * every language — duplicated from `VOICES` in `editor/voice-catalog.ts`
	 * because there is no path from a TypeScript module into PHP.
	 */
	private const VOICES = array( 'alba', 'azelma', 'cosette', 'eponine', 'fantine', 'javert', 'jean', 'marius' );

	/**
	 * Hook the section and this screen's assets.
	 */
	public static function register(): void {
		add_action( 'admin_init', array( self::class, 'register_section' ) );
		add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) );
	}

	/**
	 * Register the section only — no option, nothing to sanitise.
	 */
	public static function register_section(): void {
		add_settings_section(
			self::SECTION,
			__( 'Models', 'post-voice' ),
			array( self::class, 'render' ),
			Post_Voice_Settings_Page::MENU_SLUG
		);
	}

	/**
	 * Load the table-management script, on this screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ): void {
		if ( ! Post_Voice_Settings_Page::is_current_screen( (string) $hook_suffix ) ) {
			return;
		}

		$asset_file = POST_VOICE_PATH . 'build/models-admin.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = require $asset_file;

		wp_enqueue_style(
			'post-voice-models-admin',
			POST_VOICE_URL . 'build/style-models-admin.css',
			array(),
			$asset['version']
		);
		wp_enqueue_script(
			'post-voice-models-admin',
			POST_VOICE_URL . 'build/models-admin.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_set_script_translations( 'post-voice-models-admin', 'post-voice', POST_VOICE_PATH . 'languages' );
	}

	/**
	 * Render the table: one row per allowed language.
	 */
	public static function render(): void {
		?>
		<p><?php esc_html_e( 'Each language is a separate ~199 MB download, stored in this browser only.', 'post-voice' ); ?></p>
		<table class="widefat striped" id="post-voice-models">
			<thead>
				<tr>
					<th scope="col"><?php esc_html_e( 'Model', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Language', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Voice', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Status', 'post-voice' ); ?></th>
					<th scope="col"><?php esc_html_e( 'Size', 'post-voice' ); ?></th>
					<th scope="col"><span class="screen-reader-text"><?php esc_html_e( 'Actions', 'post-voice' ); ?></span></th>
				</tr>
			</thead>
			<tbody>
				<?php foreach ( Post_Voice_Model::ALLOWED_LANGUAGES as $language ) : ?>
				<tr data-language="<?php echo esc_attr( $language ); ?>">
					<td><?php esc_html_e( 'Kyutai Pocket TTS', 'post-voice' ); ?></td>
					<td><?php echo esc_html( self::language_label( $language ) ); ?></td>
					<td><?php self::render_voices(); ?></td>
					<td class="post-voice-model-status" role="status"><?php esc_html_e( 'Checking…', 'post-voice' ); ?></td>
					<td class="post-voice-model-size">—</td>
					<td class="post-voice-model-actions"></td>
				</tr>
				<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	/**
	 * Human-readable name for a bundle identifier.
	 *
	 * Kept in PHP rather than imported from `editor/language-labels.ts` — a
	 * server-rendered admin screen and a TypeScript panel are different
	 * runtimes, so this small map is inherent duplication, not a shortcut.
	 *
	 * @param string $language Bundle identifier, e.g. `portuguese`.
	 */
	private static function language_label( string $language ): string {
		switch ( $language ) {
			case 'english_2026-04':
				return __( 'English', 'post-voice' );
			case 'german':
				return __( 'German', 'post-voice' );
			case 'italian':
				return __( 'Italian', 'post-voice' );
			case 'portuguese':
				return __( 'Portuguese', 'post-voice' );
			case 'spanish':
				return __( 'Spanish', 'post-voice' );
			default:
				return $language;
		}
	}

	/**
	 * Render the Voice cell: a count that expands to the full list. Fully
	 * static — the eight voices never vary by language or by download state
	 * — so this needs no JavaScript.
	 */
	private static function render_voices(): void {
		$count = count( self::VOICES );
		?>
		<details>
			<summary>
				<?php
				echo esc_html(
					sprintf(
						/* translators: %d: number of voices. */
						_n( '%d voice', '%d voices', $count, 'post-voice' ),
						$count
					)
				);
				?>
			</summary>
			<ul class="post-voice-model-voices">
				<?php foreach ( self::VOICES as $voice ) : ?>
				<li><?php echo esc_html( $voice ); ?></li>
				<?php endforeach; ?>
			</ul>
		</details>
		<?php
	}
}
