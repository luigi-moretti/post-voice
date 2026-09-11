<?php
/**
 * Tests for Post_Voice_Model.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Model
 */
class Test_Post_Voice_Model extends WP_UnitTestCase {

	public function test_allowed_languages_lists_the_five_bundle_languages(): void {
		$this->assertSame(
			array( 'english_2026-04', 'german', 'italian', 'portuguese', 'spanish' ),
			Post_Voice_Model::ALLOWED_LANGUAGES
		);
	}
}
