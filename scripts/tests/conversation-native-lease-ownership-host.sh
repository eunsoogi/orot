#!/usr/bin/env bash
set -euo pipefail

root=$(git rev-parse --show-toplevel)
source="$root/apps/mobile/ios/OrotMobile/ConversationNativeSceneOwnership.swift"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Exercise the exact Foundation-only production ownership policy without booting UIKit.
{
  printf 'import Foundation\n'
  sed -n '/^struct ConversationShortLeaseBook</,/^func observeConversationBackgroundFixtureFailure/{ /^func observeConversationBackgroundFixtureFailure/!p; }' "$source"
  cat <<'SWIFT'
var registry = ConversationShortLeaseBook<Int>()
let old = UUID(), current = UUID()
registry.register(1, requestId: "a", epoch: old)
precondition(registry.retire("a", matching: old) == 1)
precondition(!registry.contains("a"))
registry.register(2, requestId: "a", epoch: current)
precondition(registry.retire("a", matching: old) == nil)
precondition(registry.contains("a"))
precondition(registry.retire("foreign", matching: current) == nil)
precondition(registry.retire("a") == 2)
precondition(registry.retire("a", matching: current) == nil)
for visible in [false, true] {
 for continued in [false, true] {
   precondition(ConversationLeaseOwnership.retainAfterShortExpiry(hasContinued: continued, hasVisibleOwner: visible) == (continued || visible))
 }
}
for short in [false, true] {
 for continued in [false, true] {
   precondition(ConversationLeaseOwnership.rearmForBackground(hasShortLease: short, hasContinued: continued) == (!short && !continued))
 }
}
print("native short lease generation ABA, exact Stop and current ownership truth tables passed")
SWIFT
} >"$tmp/main.swift"
xcrun swift "$tmp/main.swift"
