# Conversation A2UI: live final replies

Orot supports a read-only subset of the published [A2UI 1.0 agent-to-renderer
schema](https://a2ui.org/specification/v1.0/schemas/) in completed live ordinary
Conversation replies. A surface is optional. The original accepted answer still
owns Copy and the plain-text or Markdown fallback. Product reports, citations,
grounding, permissions and navigation keep their existing pathways.

- The model may provide one bounded `createSurface` message as the optional
  `a2ui` result string. The fixed ID `orot:response:draft` is not a session or
  message ID. The app delivers only the validated view to the live final bubble
  already owned by the request, not to another bubble or route.
- The allowlisted catalog identifier is
  `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`. It is never
  fetched. The native view supports read-only `Text`, `Card`, `Column`,
  `Row` and `List`. Text nodes must reproduce whole plain body paragraphs
  of the accepted reply in their original order; omitted, reordered or extra
  paragraphs trigger the normal fallback.
- The parser bounds frame length (16,384 UTF-16 code units), components (64),
  children (16 per container), tree depth (10), dictionaries (128 aggregate
  entries), path length (6 segments) and displayed text (8,192 UTF-16 code
  units total). It rejects foreign catalogs, functions, RPCs, actions,
  arbitrary navigation, URLs as UI props, external content and data sync.
- The product does not consume incremental provider surface frames or save
  structured surfaces. A stopped or reopened conversation retains only its
  existing app-owned reply representations. No new endpoint, request,
  persisted format, or transfer is introduced.
