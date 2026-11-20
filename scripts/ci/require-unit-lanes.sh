#!/usr/bin/env bash
set -euo pipefail

if [[ "${SELECTION_RESULT:-}" != success || "${SELECTION_COMPLETE:-}" != true ]]; then
  printf 'Unit test scope selection did not complete; evidence is invalid.\n' >&2
  exit 1
fi

case "${UNIT_SELECTED:-}" in
  true) expected=success ;;
  false) expected=skipped ;;
  *) printf 'Unit test selection must be true or false.\n' >&2; exit 1 ;;
esac

for lane in MOBILE_SHARD_1 MOBILE_SHARD_2 MOBILE_SHARD_3 UNIT_PACKAGES; do
  if [[ "${!lane:-}" != "$expected" ]]; then
    printf 'Unit test lane %s did not report the required %s result.\n' "$lane" "$expected" >&2
    exit 1
  fi
done

printf 'All Unit Test lanes reported the required %s result.\n' "$expected"
