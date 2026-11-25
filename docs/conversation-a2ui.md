# Conversation A2UI: live final replies

Orot supports a read-only subset of the published [A2UI 1.0 agent-to-renderer
schema](https://a2ui.org/specification/v1.0/schemas/) in completed live ordinary
Conversation replies. A surface is optional. The original accepted answer still
owns Copy and the plain-text or Markdown fallback. Product reports, citations,
grounding, permissions and navigation keep their existing pathways.

- New eligible requests submit an `a2uiFrames` array in the existing final
  result: an empty array keeps plain text, and up to twelve ordered A2UI
  `createSurface`, `updateComponents`, `updateDataModel` or `deleteSurface`
  messages may stage a read-only surface. A malformed, foreign, unresolved or
  deleted surface cannot affect the answer. Orot commits only the final tree
  from the current validated reply when its visible text matches in order.
- The previous task version may provide one bounded `createSurface` message as
  the optional `a2ui` result string. The fixed ID `orot:response:draft` is not a session or
  message ID. The app delivers only the validated view to the live final bubble
  already owned by the request, not to another bubble or route.
- The allowlisted catalog identifier is
  `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`. It is never
  fetched. The native view supports read-only `Text`, `Card`, `Column`,
  `Row` and `List`. Text nodes must reproduce whole plain body lines or
  paragraphs of the accepted reply in their original order. Omitted, reordered
  or extra text triggers the normal fallback.
- The parser bounds frame length (16,384 UTF-16 code units), components (64),
  children (16 per container), tree depth (10), dictionaries (128 aggregate
  entries), path length (6 segments) and displayed text (8,192 UTF-16 code
  units total). It rejects foreign catalogs, functions, RPCs, actions,
  arbitrary navigation, URLs as UI props, external content and data sync.
- A completed ordinary reply may retain its bounded layout (component arrangement
  only) on its exact owned protected turn. The archive never stores provider
  frames, component IDs, additional prose, actions or catalog URLs. On reopen,
  the display-only archive restores each Text leaf from the same durable
  accepted answer; unsupported or corrupt layout falls back to ordinary text.
  The archive preserves the old paragraph boundary and can also retain an
  accepted line-based arrangement. Provisional frames do not paint during
  model generation. No new endpoint, request, or transfer is introduced.
