<?php
/**
 * Checagem de capability genérica, compartilhada entre features.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * `current_user_can( 'edit_post', … )` não é lógica de narration — sempre
 * teve dois consumidores reais (Post_Voice_Post_Meta e
 * Post_Voice_Dictionary_Store), a regra que `shared/` já aplica em outro
 * lugar (`class-settings-page.php`). Antes vivia em Post_Voice_Post_Meta e
 * era referenciada de pronunciation por string-callable — a aresta 6 do
 * inventário da ADR-0005.
 *
 * Ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
 * "Mecanismo 3".
 */
class Post_Voice_Capability_Guard {

	/**
	 * Gate meta writes on the post's own edit capability.
	 *
	 * @param bool   $allowed  Whether the user can act on the meta (unused; recomputed here).
	 * @param string $meta_key Meta key being authorised (unused; every caller shares one rule).
	 * @param int    $post_id  Post the meta belongs to.
	 */
	public static function auth_callback( $allowed, $meta_key, $post_id ): bool {
		return current_user_can( 'edit_post', $post_id );
	}
}
