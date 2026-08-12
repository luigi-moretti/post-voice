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
$percent    = $statements > 0 ? ( $covered / $statements ) * 100 : 100.0;

printf( "PHP line coverage: %.2f%% (threshold: %.2f%%)\n", $percent, $threshold );

if ( $percent < $threshold ) {
	fwrite( STDERR, "✗ below threshold\n" );
	exit( 1 );
}
echo "✓ within threshold\n";
