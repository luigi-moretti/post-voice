#!/usr/bin/env node
// scripts/bump-plugin-version.mjs
//
// Rewrites the plugin's 3 hardcoded version locations to a new semver
// string. Called by semantic-release's exec plugin `prepare` step with
// the computed next version (see .releaserc.json). Regex-targeted,
// single-purpose: touches exactly the 3 lines below and nothing else —
// must never match `Requires at least:`/`Requires PHP` in
// post-voice.php or readme.txt (protected pins, see CLAUDE.md).
//
// Usage: node scripts/bump-plugin-version.mjs <version>

import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[ 2 ];

if ( ! version || ! /^\d+\.\d+\.\d+$/.test( version ) ) {
	// eslint-disable-next-line no-console
	console.error(
		`bump-plugin-version: expected a semver like 1.2.3, got ${ JSON.stringify(
			version
		) }`
	);
	process.exit( 1 );
}

function replaceOrThrow( path, pattern, replacement ) {
	const original = readFileSync( path, 'utf8' );
	if ( ! pattern.test( original ) ) {
		throw new Error(
			`bump-plugin-version: pattern not found in ${ path }: ${ pattern }`
		);
	}
	const updated = original.replace( pattern, replacement );
	writeFileSync( path, updated );
}

replaceOrThrow(
	'package.json',
	/"version":\s*"\d+\.\d+\.\d+"/,
	`"version": "${ version }"`
);

replaceOrThrow(
	'post-voice.php',
	/^ \* Version: \d+\.\d+\.\d+$/m,
	` * Version: ${ version }`
);
replaceOrThrow(
	'post-voice.php',
	/define\( 'POST_VOICE_VERSION', '\d+\.\d+\.\d+' \);/,
	`define( 'POST_VOICE_VERSION', '${ version }' );`
);

replaceOrThrow(
	'readme.txt',
	/^Stable tag: \d+\.\d+\.\d+$/m,
	`Stable tag: ${ version }`
);

// eslint-disable-next-line no-console
console.log( `bump-plugin-version: bumped to ${ version }` );
