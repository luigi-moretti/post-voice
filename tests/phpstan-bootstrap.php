<?php
/**
 * Constant declarations for static analysis.
 *
 * POST_VOICE_PATH and POST_VOICE_URL are defined in the plugin bootstrap from
 * `plugin_dir_path()`/`plugin_dir_url()` calls, which PHPStan cannot evaluate
 * while scanning — it only sees an unresolvable `define()`. Their values here are
 * placeholders; only their existence and `string` type matter to the analysis.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

define( 'POST_VOICE_PATH', '/plugins/post-voice/' );
define( 'POST_VOICE_URL', 'https://example.com/wp-content/plugins/post-voice/' );
