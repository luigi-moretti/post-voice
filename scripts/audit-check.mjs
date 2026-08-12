#!/usr/bin/env node
// Threshold-gated npm dependency audit — see "Auditoria de dependências
// (segurança)" in docs/superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md.
import { execSync } from 'node:child_process';

const productionOnly = process.argv.includes( '--production' );

const THRESHOLDS = productionOnly
	? { critical: 0, high: 0, moderate: Infinity, low: Infinity }
	: { critical: 1, high: 5, moderate: 10, low: Infinity };

function runAudit() {
	const cmd = productionOnly
		? 'npm audit --omit=dev --json'
		: 'npm audit --json';
	try {
		return execSync( cmd, { encoding: 'utf8' } );
	} catch ( error ) {
		// npm audit exits non-zero when vulnerabilities are found; stdout still has the JSON.
		return error.stdout || '{}';
	}
}

function countBySeverity( json ) {
	const report = JSON.parse( json );
	const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
	for ( const vuln of Object.values( report.vulnerabilities || {} ) ) {
		if ( counts[ vuln.severity ] !== undefined ) {
			counts[ vuln.severity ] += 1;
		}
	}
	return counts;
}

const counts = countBySeverity( runAudit() );
// eslint-disable-next-line no-console
console.log( `npm audit (${ productionOnly ? 'production' : 'all' }):`, counts );

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
