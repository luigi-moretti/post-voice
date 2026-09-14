<?php
/**
 * Tests for Post_Voice_Acceleration_Store.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * @covers Post_Voice_Acceleration_Store
 */
class Test_Post_Voice_Acceleration_Store extends WP_UnitTestCase {

	public function tear_down(): void {
		delete_option( Post_Voice_Acceleration_Store::OPTION );
		parent::tear_down();
	}

	public function test_acceleration_is_on_for_a_site_that_never_touched_the_setting(): void {
		// The option row does not exist on a fresh install, nor on any site
		// that updated into this feature. Anything but on there would be a
		// silent performance regression for all of them.
		$this->assertTrue( Post_Voice_Acceleration_Store::is_enabled() );
	}

	public function test_an_unticked_checkbox_turns_it_off(): void {
		// `options.php` hands the sanitize callback `null` for a checkbox that
		// was unticked, because an unticked checkbox posts no value at all.
		// Reading that as "absent, so use the default" would make the control
		// impossible to turn off.
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::sanitize( null )
		);

		$this->assertFalse( Post_Voice_Acceleration_Store::is_enabled() );
	}

	public function test_a_ticked_checkbox_turns_it_back_on(): void {
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::sanitize( null )
		);
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::sanitize( '1' )
		);

		$this->assertTrue( Post_Voice_Acceleration_Store::is_enabled() );
	}

	/**
	 * @dataProvider falsey_posted_values
	 *
	 * @param mixed $posted Value as it could arrive from the settings form.
	 */
	public function test_sanitize_reads_the_usual_falsey_values_as_off( $posted ): void {
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::sanitize( $posted )
		);

		$this->assertFalse( Post_Voice_Acceleration_Store::is_enabled() );
	}

	/**
	 * @return array<string, array{0: mixed}>
	 */
	public function falsey_posted_values(): array {
		return array(
			'null'         => array( null ),
			'empty string' => array( '' ),
			'zero string'  => array( '0' ),
			'false'        => array( false ),
		);
	}

	public function test_off_is_stored_as_something_wordpress_will_actually_write(): void {
		// The reason `sanitize()` does not simply return a boolean: WordPress
		// compares the new value against the current one and skips the write
		// when they match, and a missing option reads back as `false` — so
		// `update_option( ..., false )` on a site that never saved the setting
		// writes nothing at all, and the next read falls back to the default
		// "on". Storing a non-boolean makes the "off" real.
		update_option(
			Post_Voice_Acceleration_Store::OPTION,
			Post_Voice_Acceleration_Store::sanitize( null )
		);

		$this->assertNotFalse( get_option( Post_Voice_Acceleration_Store::OPTION ) );
	}
}
