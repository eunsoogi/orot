# Conversation A2UI: live final replies

Orot supports a bounded subset of the published [A2UI 1.0 agent-to-renderer
schema](https://a2ui.org/specification/v1.0/schemas/) in completed live ordinary
Conversation replies. A surface is optional. The original accepted answer still
owns Copy and the plain-text or Markdown fallback. Product reports, citations,
grounding, permissions and navigation keep their existing pathways.

- New eligible requests submit an `a2uiFrames` array in the existing final
  result (task version 24): an empty array keeps plain text, and up to twelve ordered A2UI
  `createSurface`, `updateComponents`, `updateDataModel` or `deleteSurface`
  messages may stage a surface with display-only controls. A malformed, foreign, unresolved or
  deleted surface cannot affect the answer. Orot commits only the final tree
  from the current validated reply when its visible text matches in order.
- Restored version 21 requests retain their original frame catalog without
  Divider, Icon or Tabs. Earlier version 20 requests may provide one bounded
  `createSurface` message as
  the optional `a2ui` result string. The fixed ID `orot:response:draft` is not a session or
  message ID. The app delivers only the validated view to the live final bubble
  already owned by the request, not to another bubble or route.
- The allowlisted catalog identifier is
  `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`. It is never
  fetched. The native view supports `Text`, `Card`, `Column`, `Row` and
  `List`. The ordered frame sequence also admits `Divider`, the bundled
  decorative `Icon` names `info` and `calendarToday`, and locally selected
  `Tabs` (one to eight per widget). Each tab title and its panel content
  consume exact, consecutive accepted answer lines. The resolver checks all
  panel references, including inactive tabs. Omitted, reordered or extra
  text triggers the normal fallback. Tapping a tab changes only local
  display, and does not send an action or start a request. External media
  and general URL or SVG assets are not admitted.
- Version 24 adds the Basic catalog's literal Row and Column `align` and
  `justify` properties. Larger text and narrow widths still stack rows in
  reading order. Layout hints are not accepted as style objects, bindings, or
  actions. A version 4 archive holds these resolved hints and the same
  paragraph arrangement, never new prose or data. Versions 21 through 23 keep
  their prior accepted frame grammars. Scratch-area commands do not take
  layout hints.
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
  accepted line-based arrangement. Catalog arrangements containing tabs or static leaves use a distinct version; tab titles come from the same stored answer and open at the first panel. Provisional frames do not paint model content during
  generation. No new endpoint, request, or transfer is introduced.

### Bounded proportional row children

Conversation task v29 additionally admits the pinned Basic Catalog's literal numeric
`weight` on a body `Text` child directly owned by a `Row`. Ratios from 1 to 3
divide width only when the smallest child remains readable; narrow and large-text
layouts retain source order in a stack. Other components, scratch surfaces and
historical tasks do not accept this property. Completed eligible replies archive
only the validated layout ratio and reconstruct prose from the existing answer.
No new control, URL, function, tool or external action is admitted.


Fresh Conversation task v30 also admits a literal Basic Catalog `List.direction`.
`vertical` or omission keeps the existing in-message flow. `horizontal` uses a
local horizontal viewport for bounded items; narrow bubbles, nested narrow
cards and larger accessibility fonts preserve a vertical reading order instead.
Archive v6 records only the horizontal arrangement; v1–v5 behavior and exact
prose fallback remain unchanged. This does not add any action, link or media.

Fresh Conversation task v31 adds literal cross-axis alignment on vertical Lists:
`start`, `center`, `end`, or `stretch`. Horizontal lists retain their existing
behavior. The app still owns accessibility, responsive layout, all reading order,
and the exact accepted answer. Archive version 7 retains layout tokens only.


Fresh ordinary Conversation task v32 also accepts one read-only Basic Catalog
`Modal` in a single static final `createSurface`. Its literal `trigger` and
`content` are distinct existing component IDs; the trigger is a body Text
paragraph and both branches retain the original answer order. A tap opens an
app-owned sheet only for the active completed message and currently available
native protected data. Dismissal, losing the message or screen, and native
protection loss close it. No protocol action or provider call is emitted. Older
task contracts still reject Modal, and the owned archive stores the same
verified prose as inline layout and cannot reopen a sheet.


Fresh v33 ordinary replies additionally accept one Basic Catalog Text
`variant: "caption"` for the exact last prose paragraph of a single static
completed surface, after at least one body paragraph. The app uses its
existing scaled caption style, does not infer a caption from phrasing, and
keeps the original copy text. Caption is not a heading or action; Modal, Tabs,
weights and incremental caption updates do not use this variant. The existing
archive keeps the exact caption paragraph readable as ordinary body text.

## Final repeated children

Task v37 admits one data-bound Row, Column, or List from the
[Basic Catalog's ChildList form](https://a2ui.org/specification/v1.0-basic-catalog-implementation-guide/).
The create frame must name a shallow local template with the exact
`{"path":"/items","componentId":"template"}` child form. An optional final
`updateDataModel` can replace the complete `/items` array once. A reusable
template can nest cards and rows/columns around text bound to single relative
item keys. The renderer never resolves an absolute path, external request,
function, action, alias or second repeated template.

The terminal parser materializes up to 12 items and 64 total graph nodes under
derived stable IDs, removes the original data model, and runs the same exact
accepted-prose validation as a static layout. Only that ordered tree can be
rendered or archived. A foreign frame, mismatched answer, or unsupported
template falls back to original prose.

For the owning ChatGPT Plan live reply, complete repeated-child frames can
update a neutral placeholder before the final answer. An accepted scratch
graph contributes only its bounded row or stack geometry, never model prose,
IDs, bindings, or interactive controls. Losing ownership removes the hint.
The existing final answer and evidence checks still own publication. Other
providers do not acquire a new stream path, and arbitrary data-bound widgets
and sendDataModel remain unsupported.

