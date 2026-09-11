<?php
/**
 * O que o bundle do modelo Pocket TTS suporta.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Dono do dado "quais idiomas o modelo aceita" — antes vivia em
 * Post_Voice_Rest_Api, uma classe de transporte HTTP, sem relação com o
 * significado do dado. Equivalente PHP de `SUPPORTED_LANGUAGES` em
 * `model-source.ts`, que já mora ao lado do pin `MODEL_BASE_URL`.
 *
 * Ver docs/superpowers/specs/2026-09-11-topologia-nucleo-extensoes-design.md,
 * "Mecanismo 2".
 */
class Post_Voice_Model {

	public const ALLOWED_LANGUAGES = array( 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' );
}
