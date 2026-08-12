<?php
/**
 * Fail the build when PHP line coverage drops below a threshold.
 *
 * PHPUnit 9 has no native "fail below X%" flag, so CI reads the Clover report
 * this script parses.
 *
 * @package Post_Voice
 */

declare(strict_types=1);

[ $script, $clover_path, $threshold_arg ] = $argv + array( null, null, null );
if ( ! $clover_path || ! $threshold_arg ) {
	fwrite( STDERR, "Usage: check-coverage-threshold.php <clover.xml> <threshold-percent>\n" );
	exit( 1 );
}

$threshold = (float) $threshold_arg;
$xml       = simplexml_load_file( $clover_path );
if ( ! $xml ) {
	fwrite( STDERR, "Could not parse {$clover_path}\n" );
	exit( 1 );
}

$metrics    = $xml->project->metrics;
$statements = (int) $metrics['statements'];
$covered    = (int) $metrics['coveredstatements'];

// Zero statements means no coverage was measured at all — almost always a
// missing pcov/Xdebug driver, since PHPUnit 9 emits an empty Clover report
// rather than failing. Treating that as 100% would turn this gate into a
// rubber stamp precisely when it stopped working.
if ( 0 === $statements ) {
	fwrite( STDERR, "✗ {$clover_path} reports 0 statements — no coverage driver (pcov/Xdebug)?\n" );
	exit( 1 );
}

$percent = ( $covered / $statements ) * 100;

printf( "PHP line coverage: %.2f%% (threshold: %.2f%%)\n", $percent, $threshold );

if ( $percent < $threshold ) {
	fwrite( STDERR, "✗ below threshold\n" );
	exit( 1 );
}
echo "✓ within threshold\n";
