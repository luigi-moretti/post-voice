<?php
/**
 * Shared test helper: fabricate or hide a build entry's `.asset.php` manifest.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

/**
 * Guarantee an asset manifest exists, or guarantee it is absent, for the
 * duration of a test.
 *
 * `build/` is gitignored and CI's PHP job never runs `npm run build`, so any
 * test that exercises an `enqueue()` guarded on `file_exists( ... .asset.php )`
 * needs to fabricate a stand-in manifest itself rather than rely on a
 * developer's local build being present. Written to disk rather than mocked
 * because the classes under test read it with `require`.
 */
trait Post_Voice_With_Asset_File {

	/**
	 * Paths this test wrote a stand-in asset file for, to be removed again.
	 *
	 * @var string[]
	 */
	private array $fabricated_asset_files = array();

	/**
	 * Paths this test moved a real asset file aside for, to be restored.
	 *
	 * @var string[]
	 */
	private array $hidden_asset_files = array();

	/**
	 * A run killed between `without_asset_file()` and `tear_down_asset_files()`
	 * leaves the real manifest parked at `.testbak`, and every later run then
	 * tests a build that looks missing. Call this from `set_up()` for every
	 * path a test might hide. Cost of not doing this: a mystery failure that
	 * survives until someone notices a stray file. Cost of doing it: one stat
	 * per path.
	 *
	 * @param string $path Path of the asset manifest.
	 */
	private function recover_parked_asset_file( string $path ): void {
		$parked = $path . '.testbak';
		if ( file_exists( $parked ) && ! file_exists( $path ) ) {
			rename( $parked, $path );
		}
	}

	/**
	 * Guarantee the asset manifest exists.
	 *
	 * @param string $path     Path of the asset manifest.
	 * @param string $contents PHP source the fabricated file should return.
	 */
	private function with_asset_file(
		string $path,
		string $contents = "<?php return array( 'dependencies' => array( 'wp-element' ), 'version' => 'test' );\n"
	): void {
		if ( file_exists( $path ) ) {
			return;
		}

		if ( ! is_dir( dirname( $path ) ) ) {
			mkdir( dirname( $path ), 0777, true );
		}
		file_put_contents( $path, $contents );
		$this->fabricated_asset_files[] = $path;
	}

	/**
	 * Guarantee the asset manifest is absent, restoring a real one afterwards.
	 *
	 * @param string $path Path of the asset manifest.
	 */
	private function without_asset_file( string $path ): void {
		if ( ! file_exists( $path ) ) {
			return;
		}

		rename( $path, $path . '.testbak' );
		$this->hidden_asset_files[] = $path;
	}

	/**
	 * Undo whatever `with_asset_file()` and `without_asset_file()` did. Call
	 * this from `tear_down()`.
	 */
	private function tear_down_asset_files(): void {
		foreach ( $this->fabricated_asset_files as $path ) {
			unlink( $path );
		}
		$this->fabricated_asset_files = array();

		foreach ( $this->hidden_asset_files as $path ) {
			rename( $path . '.testbak', $path );
		}
		$this->hidden_asset_files = array();
	}
}
