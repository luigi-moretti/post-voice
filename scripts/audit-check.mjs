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

/**
 * Reduce npm's report to distinct (advisory, vulnerable package) pairs.
 *
 * npm's own `metadata.vulnerabilities` counts *nodes of the dependency tree*,
 * not problems, and is wrong in both directions: one advisory reaching six
 * dependents counts six, while three advisories on a single package collapse
 * into one (npm/cli#4272). This project hit the first case — seven "high"
 * findings that were one unpatched advisory in `extract-zip`, counted again for
 * every package that leads to it.
 *
 * The pair is the unit the rest of the industry reports. Snyk splits the same
 * data into "issues" (the offending package) and "vulnerable paths" (the chains
 * that reach it) and headlines the former; Dependabot raises one alert per
 * advisory per manifest; Trivy treats counting the same CVE twice for one
 * package as a bug. Keying on the pair rather than on the advisory alone also
 * keeps a single advisory that genuinely affects two different packages
 * counting as two.
 *
 * In npm's JSON, an entry whose `via` holds objects is a package that is itself
 * vulnerable, one object per advisory. An entry whose `via` holds only strings
 * is flagged for depending on one of those — a path, not a problem.
 *
 * @param {string} json Raw `npm audit --json` output.
 */
function collectIssues( json ) {
	const report = JSON.parse( json );
	const issues = new Map();
	let affectedPackages = 0;

	for ( const [ name, entry ] of Object.entries(
		report.vulnerabilities || {}
	) ) {
		affectedPackages += 1;

		for ( const via of entry.via || [] ) {
			if ( typeof via === 'string' ) {
				continue;
			}
			issues.set( `${ via.source ?? via.url }::${ name }`, {
				package: name,
				severity: via.severity ?? entry.severity,
				title: via.title,
				url: via.url,
			} );
		}
	}

	return { issues: [ ...issues.values() ], affectedPackages };
}

function countBySeverity( issues ) {
	const counts = { critical: 0, high: 0, moderate: 0, low: 0 };
	for ( const issue of issues ) {
		if ( counts[ issue.severity ] !== undefined ) {
			counts[ issue.severity ] += 1;
		}
	}
	return counts;
}

const { issues, affectedPackages } = collectIssues( runAudit() );
const counts = countBySeverity( issues );

/* eslint-disable no-console */
console.log( `npm audit (${ productionOnly ? 'production' : 'all' }):`, counts );
if ( issues.length > 0 ) {
	console.log(
		`  ${ issues.length } issue(s) across ${ affectedPackages } affected package(s):`
	);
	for ( const issue of issues ) {
		console.log(
			`  - [${ issue.severity }] ${ issue.package }: ${ issue.title } (${ issue.url })`
		);
	}
}

const failures = Object.entries( THRESHOLDS ).filter(
	( [ severity, max ] ) => counts[ severity ] > max
);
if ( failures.length > 0 ) {
	for ( const [ severity, max ] of failures ) {
		console.error(
			`✗ ${ severity }: ${ counts[ severity ] } found, threshold is ${ max }`
		);
	}
	process.exit( 1 );
}
console.log( '✓ within thresholds' );
/* eslint-enable no-console */
