#!/usr/bin/env node
// Threshold-gated composer dependency audit — 0 critical/0 high, matches
// npm's production threshold (no runtime PHP deps exist yet, gate stays
// ready for when that changes).
import { execSync } from 'node:child_process';

const THRESHOLDS = { critical: 0, high: 0, moderate: Infinity, low: Infinity };

function runAudit() {
	try {
		return execSync( 'composer audit --format=json', { encoding: 'utf8' } );
	} catch ( error ) {
		return error.stdout || '{}';
	}
}

function countBySeverity( json ) {
	const report = JSON.parse( json );
	const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
	for ( const advisories of Object.values( report.advisories || {} ) ) {
		for ( const advisory of advisories ) {
			const severity = ( advisory.severity || 'low' ).toLowerCase();
			if ( counts[ severity ] !== undefined ) {
				counts[ severity ] += 1;
			}
		}
	}
	return counts;
}

const counts = countBySeverity( runAudit() );
// eslint-disable-next-line no-console
console.log( 'composer audit:', counts );

const failures = Object.entries( THRESHOLDS ).filter(
	( [ severity, max ] ) => counts[ severity ] > max
);
if ( failures.length > 0 ) {
	for ( const [ severity, max ] of failures ) {
		// eslint-disable-next-line no-console
		console.error(
			`✗ ${ severity }: ${ counts[ severity ] } found, threshold is ${ max }`
		);
	}
	process.exit( 1 );
}
// eslint-disable-next-line no-console
console.log( '✓ within thresholds' );
