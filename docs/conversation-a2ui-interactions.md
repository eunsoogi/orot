# Local A2UI interaction boundary

The standalone Conversation host adapter builds the `action` variant of the
published [renderer-to-agent A2UI 1.0 schema](https://github.com/a2ui-project/a2ui/blob/a23b19c4f2102695c506adb7d1ded1f5f81a7688/specification/v1_0/json/renderer_to_agent.json).
A2UI resolves action context against the surface data model; this subset resolves
only explicit aliases to app-admitted local scalar fields, not arbitrary
arguments. It omits optional user messages and metadata. Local edits and revert
never emit an event, affect another surface, persist, or leave the process.

The eventual app host owns the privacy and gesture boundary:

- After committing a verified surface, create the adapter with a fresh opaque
  owner for that exact surface and mounted component revision. Supply only
  actual rendered controls and a separate app-owned action allowlist, never a
  model declaration as authority. `isCurrent` must cover the exact mounted
  revision, not just the conversation or route. On hiding, replacement, lock,
  or unmount, call `retire`; never reuse the owner even on restore.
- Pass the host's owner, surface ID and component ID to every read, write and
  action. Only mounted controls may change their approved local field. The
  subset accepts absolute named paths up to four segments and scalar text,
  booleans and bounded finite numbers. Encoded/relative paths, undeclared keys,
  conflicting paths, functions, extensions and arbitrary payloads are not
  admitted.
- Mint a receipt only in the actual native user gesture handler. Consume it at
  most once, in the same owner and source component; edits or owner loss retire
  old receipts. Timestamp is captured at that gesture, not later and not from
  the wire. No action is restored from disk or inferred from frame replay.
- The returned envelope is local data only, not authorization for a tool,
  provider request, mutation, URL opening, or user-message submission.

This change deliberately does not enable controls in the existing read-only live
or restored renderer. Future wiring, any meaningful product action, actual
native taps, and any separately authorized transport require their own work.
