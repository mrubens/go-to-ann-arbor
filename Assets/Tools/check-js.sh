#!/bin/sh
# node's syntax check of each of the game's modules given (or all of Web/js)
cd "$(dirname "$0")/../.."
for f in "${@:-Web/js/*.js}"; do
  for g in $f; do node --input-type=module --check < "$g" || echo "FAILED $g"; done
done
echo checked
