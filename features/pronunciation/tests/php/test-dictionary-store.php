<?php
/**
 * Dictionary sanitisation tests.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Dictionary_Store
 */
class Test_Post_Voice_Dictionary_Store extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();

		// WP_UnitTestCase unregisters every meta key between tests, so the
		// plugin's own `init` registration from bootstrap does not survive.
		Post_Voice_Dictionary_Store::register();
	}

	public function test_register_registers_the_post_meta(): void {
		$registered = get_registered_meta_keys( 'post', 'post' );

		$this->assertArrayHasKey( Post_Voice_Dictionary_Store::META, $registered );
		$this->assertSame( array(), $registered[ Post_Voice_Dictionary_Store::META ]['default'] );

		// The property that actually carries the security weight: this is what
		// stops an unsanitised block-editor meta write from ever reaching the
		// database, so the wiring is only meaningful if this assertion holds.
		$this->assertSame(
			array( Post_Voice_Dictionary_Store::class, 'sanitize' ),
			$registered[ Post_Voice_Dictionary_Store::META ]['sanitize_callback']
		);
	}

	public function test_sanitize_keeps_a_complete_entry(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame(
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'portuguese',
				),
			),
			$result
		);
	}

	public function test_sanitize_drops_an_entry_with_an_unsupported_language(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'klingon',
				),
			)
		);

		$this->assertSame( array(), $result );
	}

	public function test_sanitize_drops_an_empty_term_or_replacement(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => '   ',
					'replacement' => 'x',
					'language'    => 'portuguese',
				),
				array(
					'term'        => 'BYD',
					'replacement' => '',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( array(), $result );
	}

	public function test_sanitize_keeps_the_valid_entries_around_an_invalid_one(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => 'one',
					'replacement' => 'um',
					'language'    => 'portuguese',
				),
				array(
					'term'        => 'two',
					'replacement' => '',
					'language'    => 'portuguese',
				),
				array(
					'term'        => 'three',
					'replacement' => 'tres',
					'language'    => 'portuguese',
				),
				array(
					'term'        => 'four',
					'replacement' => 'quatro',
					'language'    => 'portuguese',
				),
			)
		);

		// A single malformed row must not cost the author the other three: an
		// early `return array()` on the first bad entry would pass every other
		// test in this file but fail this one.
		$this->assertSame(
			array( 'one', 'three', 'four' ),
			array_column( $result, 'term' )
		);
	}

	public function test_sanitize_strips_tags_from_both_fields(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => '<b>BYD</b>',
					'replacement' => 'Bi <script>alert(1)</script>Iou Di',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( 'BYD', $result[0]['term'] );
		$this->assertStringNotContainsString( '<', $result[0]['replacement'] );
	}

	public function test_sanitize_truncates_beyond_the_length_caps(): void {
		$result = Post_Voice_Dictionary_Store::sanitize(
			array(
				array(
					'term'        => str_repeat( 'a', 200 ),
					'replacement' => str_repeat( 'b', 400 ),
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame(
			Post_Voice_Dictionary_Store::MAX_TERM_LENGTH,
			strlen( $result[0]['term'] )
		);
		$this->assertSame(
			Post_Voice_Dictionary_Store::MAX_REPLACEMENT_LENGTH,
			strlen( $result[0]['replacement'] )
		);
	}

	public function test_sanitize_caps_the_number_of_entries(): void {
		$entries = array();
		for ( $i = 0; $i < Post_Voice_Dictionary_Store::MAX_ENTRIES + 10; $i++ ) {
			$entries[] = array(
				'term'        => 'termo' . $i,
				'replacement' => 'valor' . $i,
				'language'    => 'portuguese',
			);
		}

		$this->assertCount(
			Post_Voice_Dictionary_Store::MAX_ENTRIES,
			Post_Voice_Dictionary_Store::sanitize( $entries )
		);
	}

	public function test_sanitize_rejects_a_non_array(): void {
		$this->assertSame( array(), Post_Voice_Dictionary_Store::sanitize( 'BYD' ) );
		$this->assertSame( array(), Post_Voice_Dictionary_Store::sanitize( null ) );
	}

	public function test_get_global_returns_the_sanitised_option(): void {
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'ONNX',
					'replacement' => 'ó-nex',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( 'ONNX', Post_Voice_Dictionary_Store::get_global()[0]['term'] );
	}

	public function test_get_global_sanitises_a_row_written_directly(): void {
		// Bypasses sanitize_callback entirely, the way a migration or a direct
		// database edit would. A stub that returned the raw option untouched
		// would still pass every other test in this file but fail this one.
		update_option(
			Post_Voice_Dictionary_Store::OPTION,
			array(
				array(
					'term'        => 'BYD',
					'replacement' => 'Bi Iou Di',
					'language'    => 'klingon',
				),
			)
		);

		$this->assertSame( array(), Post_Voice_Dictionary_Store::get_global() );
	}

	public function test_get_for_post_returns_an_empty_array_when_unset(): void {
		$post_id = self::factory()->post->create();

		$this->assertSame( array(), Post_Voice_Dictionary_Store::get_for_post( $post_id ) );
	}

	public function test_get_for_post_sanitises_a_row_written_directly(): void {
		$post_id = self::factory()->post->create();

		// Bypasses sanitize_callback entirely, the way a migration or a direct
		// database edit would. A stub that returned the raw meta untouched would
		// still pass every other test in this file but fail this one.
		update_post_meta(
			$post_id,
			Post_Voice_Dictionary_Store::META,
			array(
				array(
					'term'        => 'BYD',
					'replacement' => '',
					'language'    => 'portuguese',
				),
			)
		);

		$this->assertSame( array(), Post_Voice_Dictionary_Store::get_for_post( $post_id ) );
	}
}
