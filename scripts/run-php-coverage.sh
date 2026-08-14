#!/usr/bin/env bash
#
# Run the PHPUnit suite with line coverage and check it against the spec's 85%
# floor — without installing anything on this machine.
#
# The host PHP has no coverage driver, and wp-env's image ships none either
# (`wp-env start --xdebug` rebuilds the image, which is a heavier detour than
# this). So coverage runs in a throwaway php:8.2-cli container that installs
# pcov and mysqli at start-up, mounts the repository and the WordPress test
# install wp-env unpacked, and joins wp-env's own Docker network to reach MySQL.
#
# The network matters: `--network host` does not work under Docker Desktop,
# where the "host" is the VM rather than this machine, and the published MySQL
# port is not reachable from there. Joining the compose network and addressing
# the container by its `tests-mysql` alias works in both setups.
#
# Usage: npm run test:php:coverage [-- <phpunit args>]

set -euo pipefail

cd "$(dirname "$0")/.."

install_path="${WP_ENV_INSTALL_PATH:-$( npx wp-env install-path | tail -1 )}"
tests_wp="$install_path/tests-WordPress"

if [ ! -d "$tests_wp" ]; then
	echo "WordPress test install not found. Run 'npx wp-env start' first." >&2
	exit 1
fi

network="$( docker inspect "$( docker ps --filter 'name=tests-mysql' --format '{{.Names}}' | head -1 )" \
	--format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' 2>/dev/null || true )"

if [ -z "$network" ]; then
	echo "wp-env's tests MySQL container is not running. Run 'npx wp-env start' first." >&2
	exit 1
fi

# Built once and reused: compiling pcov on every run costs a minute and depends
# on pecl being reachable, which it intermittently is not.
image="post-voice-phpunit:8.2"
if ! docker image inspect "$image" > /dev/null 2>&1; then
	echo "Building $image (one-off)…"
	docker build -q -t "$image" - <<-'DOCKER'
		FROM php:8.2-cli
		RUN docker-php-ext-install -j4 mysqli \
		 && pecl install pcov \
		 && docker-php-ext-enable pcov
	DOCKER
fi

# Passed to `sh -c` rather than mounted as a file: Docker Desktop only shares
# configured paths, and a script in /tmp is refused with "mounts denied".
runner='
set -e
vendor/bin/phpunit --coverage-clover coverage/clover.xml "$@"
php scripts/check-coverage-threshold.php coverage/clover.xml 85
'

docker run --rm --network "$network" \
	-v "$PWD":/app \
	-v "$tests_wp":/wp \
	-e WP_TESTS_ABSPATH=/wp/ \
	-e WP_TESTS_DB_HOST=tests-mysql:3306 \
	-e WP_TESTS_DB_NAME="${WP_TESTS_DB_NAME:-tests-wordpress}" \
	-e WP_TESTS_DB_USER="${WP_TESTS_DB_USER:-root}" \
	-e WP_TESTS_DB_PASSWORD="${WP_TESTS_DB_PASSWORD:-password}" \
	-e WP_PHPUNIT__DIR=vendor/wp-phpunit/wp-phpunit \
	-w /app "$image" sh -c "$runner" -- "$@"
