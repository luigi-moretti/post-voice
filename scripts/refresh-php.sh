#!/usr/bin/env bash
# Docker Desktop's file-sharing cache keeps serving the old contents of a PHP
# file edited in place. Rewriting via cp+mv (new inode) used to be enough; it is
# not always — the directory entry has to actually disappear and come back
# before the change propagates. Hence rm between the copy and the rename.
#
# Do NOT preserve timestamps (`cp -p`): PHP's opcache decides whether to
# recompile by mtime, so a byte-different file carrying the original mtime is
# served from the compiled cache anyway.
set -e
cd "$(git rev-parse --show-toplevel)"
find features post-voice.php -name '*.php' -type f | while read -r f; do
  cp "$f" "$f.refresh"
  rm "$f"
  mv "$f.refresh" "$f"
  touch "$f"
done
