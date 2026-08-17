<?php
/**
 * Tests for Post_Voice_Style_Store.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Style_Store
 */
class Test_Post_Voice_Style_Store extends WP_UnitTestCase {

	public function test_non_array_input_gives_the_defaults(): void {
		$this->assertSame( Post_Voice_Style_Store::DEFAULTS, Post_Voice_Style_Store::sanitize( 'nope' ) );
		$this->assertSame( Post_Voice_Style_Store::DEFAULTS, Post_Voice_Style_Store::sanitize( null ) );
	}

	public function test_a_bad_colour_falls_back_without_taking_the_others_with_it(): void {
		$clean = Post_Voice_Style_Store::sanitize(
			array(
				'surface' => 'javascript:alert(1)',
				'accent'  => '#c00000',
				'text'    => '#ffffff',
				'radius'  => 'square',
			)
		);

		$this->assertSame( '#1e1e1e', $clean['surface'] );
		$this->assertSame( '#c00000', $clean['accent'] );
		$this->assertSame( 'square', $clean['radius'] );
	}

	public function test_three_digit_hex_is_accepted_and_kept_short(): void {
		$clean = Post_Voice_Style_Store::sanitize( array( 'accent' => '#ABC' ) );

		$this->assertSame( '#abc', $clean['accent'] );
	}

	public function test_missing_and_unknown_keys_are_handled(): void {
		$clean = Post_Voice_Style_Store::sanitize(
			array(
				'accent'   => '#c00000',
				'nonsense' => 'x',
			)
		);

		$this->assertSame( array( 'surface', 'accent', 'text', 'radius' ), array_keys( $clean ) );
		$this->assertSame( '#1e1e1e', $clean['surface'] );
		$this->assertArrayNotHasKey( 'nonsense', $clean );
	}

	public function test_radius_outside_the_whitelist_falls_back_to_pill(): void {
		$clean = Post_Voice_Style_Store::sanitize( array( 'radius' => '99px' ) );

		$this->assertSame( 'pill', $clean['radius'] );
	}

	public function test_expand_hex_lengthens_the_short_form_only(): void {
		$this->assertSame( '#aabbcc', Post_Voice_Style_Store::expand_hex( '#abc' ) );
		$this->assertSame( '#c00000', Post_Voice_Style_Store::expand_hex( '#c00000' ) );
	}

	public function test_css_is_empty_when_nothing_differs_from_the_defaults(): void {
		update_option( Post_Voice_Style_Store::OPTION, Post_Voice_Style_Store::DEFAULTS );

		$this->assertSame( '', Post_Voice_Style_Store::css_declarations() );
		$this->assertSame( '', Post_Voice_Style_Store::inline_css() );
	}

	public function test_css_carries_only_what_changed(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'accent' => '#c00000' ) + Post_Voice_Style_Store::DEFAULTS
		);

		$this->assertSame( '--pv-accent:#c00000', Post_Voice_Style_Store::css_declarations() );
		$this->assertSame( '.post-voice-player{--pv-accent:#c00000}', Post_Voice_Style_Store::inline_css() );
	}

	public function test_radius_reaches_the_css_as_a_length_never_as_the_key(): void {
		update_option(
			Post_Voice_Style_Store::OPTION,
			array( 'radius' => 'rounded' ) + Post_Voice_Style_Store::DEFAULTS
		);

		$this->assertSame( '--pv-radius:12px', Post_Voice_Style_Store::css_declarations() );
	}

	public function test_get_sanitises_a_row_written_straight_to_the_database(): void {
		update_option( Post_Voice_Style_Store::OPTION, array( 'accent' => 'red; }' ) );

		$this->assertSame( '#2b62f0', Post_Voice_Style_Store::get()['accent'] );
	}
}
