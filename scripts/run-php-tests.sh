#!/usr/bin/env bash
#
# Run the PHPUnit suite against the WordPress install and MySQL that `wp-env`
# provisions.
#
# PHPUnit runs on the *host*, not inside the container, deliberately: Docker
# Desktop's file-sharing layer does not reliably propagate host edits into a
# running container, so an in-container run can execute a stale copy of the code
# and silently report success on files that no longer exist. wp-env unpacks
# WordPress core onto the host filesystem and publishes MySQL on a host port, so
# everything the test suite needs is reachable without the shared-filesystem
# round trip.
#
# Every value can be overridden by exporting it first — CI sets its own.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${WP_TESTS_ABSPATH:-}" ]; then
	install_path="$( npx wp-env install-path | tail -1 )"
	if [ ! -d "$install_path/tests-WordPress" ]; then
		echo "WordPress test install not found. Run 'npx wp-env start' first." >&2
		exit 1
	fi
	export WP_TESTS_ABSPATH="$install_path/tests-WordPress/"
fi

if [ -z "${WP_TESTS_DB_HOST:-}" ]; then
	# wp-env maps the tests MySQL container's 3306 to an ephemeral host port; read
	# the actual value rather than assuming one.
	port="$( docker ps --filter 'name=tests-mysql' --format '{{.Ports}}' \
		| grep -o '0.0.0.0:[0-9]*->3306' | head -1 | cut -d: -f2 | cut -d- -f1 )"
	if [ -z "$port" ]; then
		echo "wp-env's tests MySQL container is not running. Run 'npx wp-env start' first." >&2
		exit 1
	fi
	export WP_TESTS_DB_HOST="127.0.0.1:$port"
fi

export WP_TESTS_DB_NAME="${WP_TESTS_DB_NAME:-tests-wordpress}"
export WP_TESTS_DB_USER="${WP_TESTS_DB_USER:-root}"
export WP_TESTS_DB_PASSWORD="${WP_TESTS_DB_PASSWORD:-password}"
export WP_PHPUNIT__DIR="${WP_PHPUNIT__DIR:-vendor/wp-phpunit/wp-phpunit}"

exec vendor/bin/phpunit "$@"
