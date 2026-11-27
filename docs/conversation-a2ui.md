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

## Independent sections in one reply

Fresh v38 replies can compose two data-bound sections under one surface.
The additional section repeats its own isolated template from
`/secondaryItems`; the first retains `/items`. A reply can, for example,
show a compact summary row followed by a vertical list of next steps.
Each section accepts at most one whole-array replacement. The two templates
cannot share or reference one another's nodes, bindings or generated IDs.

The accepted answer order, the aggregate 64-node budget, and ordinary archive
validation apply to the combined layout. v37 remains unchanged for restored
requests and the existing provisional geometry path; no new layout or values
are published provisionally for two-section replies.

## Two independent detail sheets

Fresh v39 ordinary replies may place two read-only Modal components directly
under the root Column of one static final surface. Such a reply can show a
summary inline, with separate evidence and method details. The exact accepted
answer includes both triggers and all panel text in reading order.

The reply owns just one pending native admission or open sheet. Starting both
at once cannot open two native sheets, and losing the owning reply or protected
data cancels the pending or visible sheet. Legacy archives retain the text
inline, and eligible v8 archives use the separate restored path below.
Prior responder versions still admit at most
one Modal; no new protocol action or external call is introduced.

## Restored detail panels

Version 8 locally archives only the positions of two already accepted detail
panels and their existing text layout, and only for complete ordinary replies
with no citations, sources, or retained ancestry. Older layouts keep their
inline presentation, and a v8 shape alone never grants an interactive sheet.

An explicit tap in the active, mounted archive rechecks the exact protected
completion row, version, revision, and empty source relations. It also rechecks
native protected-data availability before presenting the selected panel. A
missing or changed row, stale route, or unavailable device protection leaves
the accepted content inline; an ownership change closes an open sheet.
Nothing about the archived action is sent to a provider or written on a tap.

## Inline rich Text in live layouts

Fresh v40 ordinary completed replies can render strong, emphasis and inline
code inside accepted Basic Catalog Text prose. For example, a Card paragraph
or a Tab panel may emphasize terms without flattening the surrounding layout.
The full answer and all Text fields must still match exactly, including the
Markdown markers. Copy uses the original answer. HTML, link and image syntax
is not admitted in the structured rich-text path; no action, URL handling,
or external transfer is introduced.

For eligible source/citation/ancestry-free completed v40 replies, local
archive v9 retains only the static arrangement and which answer leaves were
formatted. No prose, wire messages, markup fragments, IDs or destinations
are added to the layout. A missing or unsupported layout uses the ordinary
saved Markdown view. Prior responder versions and v7/v8 archives are unchanged.

Reopening v9 uses the already authorized page read and confirms the same
unchanged encrypted revision, active route and native protection before
drawing. A protected-state change, stale row or mutation retires that mount.
There are no extra SQLite queries, provider requests, or action endpoints.
Tab and Modal labels and locally editable controls keep their current design.

## Local string assembly inside repeated items

Fresh ordinary task v41 supports a bounded Basic Catalog `formatString` in a
final repeated body Text node. For example, `{"@call":"formatString","args":{"value":"Time: ${duration}"}}`
renders a local item field with its label in the same native layout. Each
expression may reference at most four simple relative string fields from that
item, in either of the existing isolated repeated sections. It supports no
nested functions, escaped expressions, absolute paths, network, arbitrary
actions, or renderer-to-agent data model synchronization.

Substitution is a final-only layout preparation step. All resulting lines
must match the already accepted answer exactly and stay under existing graph
and text limits. The archive, if eligible, stores only the resolved display
shape. Versions v37 through v40 accept precisely their prior graphs, and the
streaming placeholder never acquires formatter values or user data.

## Temporary confirmation and choice together

Fresh ordinary task v42 can display an app-owned CheckBox and ChoicePicker
in the same completed reply. The model composes them after two exact answer
parts in their existing order, using their already supported labels and
options. The form starts with `false` and `[]`, in that order, at the two
distinct local paths. Other seeds, bound paths, actions and control layouts
remain unsupported.

Each control changes only its own field. Both share the exact active response
owner and are retired together when that owner or mount changes. Reopening
an archive does not restore either field or replay an action. Neither field
is shared with the model or written to local storage. Prior single-control
and final formatting contracts retain their original behavior.

## Reactive local scratch preview

Fresh ordinary task v43 may add a read-only Text bound to the same
`/local/draft` path as the existing temporary scratch field. It appears
after the existing Reset control and shows what the user typed on this
screen. Reset clears the input and preview together. The app provides the
preview label. It does not send or save the value, join it to the accepted
answer or Copy, or speak it automatically.

Only the exact completed, foreground conversation owner may edit or render
the scratch preview. Leaving the owner or reopening an archive never
restores its input. Other paths, initial values, model-generated text in
the preview, and new actions remain unsupported.

## Composed labels for paired controls

Fresh task v44 keeps the same local paths, empty seeds and two app-owned
choice values. For a paired form only, the model can compose short, plain
display labels for its checkbox, radio group, and two distinct options.
The full accepted prose may have more than two parts, but a surface still
cannot change, omit or reorder any part. No action, storage, or external
request is added. Replies using v42 or v43 keep their original rules.

## Model-composed local controls

New ordinary replies on task v45 can place CheckBox, shortText TextField,
and single- or multiple-selection ChoicePicker anywhere in an admitted
layout. This removes fixed field names, form recipes, prose counts, and
two-option requirements for new controls. Literal labels and option
tokens are composed by the model, with one distinct local binding path
per control. The existing safe read-only catalog and v44 and earlier
contracts still work.

These fields are visible only for the current completed bubble. They
start empty, clear when ownership is lost, and never submit a value,
run actions, or write local data. Reopening keeps the accepted prose
rather than restoring this form. The model still cannot add remote
catalogs, arbitrary links or actions, data uploads, or controls owned
by another reply.

Fresh ordinary task v46 also allows the Basic Catalog Slider within composed
local controls. It accepts a literal label, distinct local value pointer,
integer bounds between -1000 and 1000, and up to 100 equal divisions. The
initial thumb is at the lower bound; provider values, actions, app bindings,
and durable or transmitted slider state remain unsupported. Restoring v45
uses the previous catalog unchanged. An invalid Slider retains exact prose.

Fresh ordinary task v47 supports the date-only part of Basic Catalog
DateTimeInput in the same ephemeral controls. It accepts a labelled local
pointer and ordered literal ISO calendar dates, not time, dynamic min/max,
seeds, calendar access or scheduling. A date is not chosen until the user
confirms it in that bubble. Earlier task contracts and render fallback remain
unchanged; neither the chosen date nor its control is stored or sent.

Fresh ordinary task v48 also supports up to four short literal Caption Text
leaves in a single static layout, for example one under the content of each
Tab or Card. The ordinary validator still checks every reference, tab title,
and accepted prose line in reading order. Caption hints do not add content,
bindings, controls, or actions. The existing archive keeps the accepted text
and layout but renders those lines as body Text. Earlier task policies and
incremental layout remain unchanged.

Fresh ordinary task v49 supports a same-surface atomic component update that
replaces a ready layout while preserving every accepted answer line. An
unchanged Card, Column, Row or List wrapper made unreachable by that update
is retired and cannot be reused. Dropped text, new orphans, unresolved
retired references and foreign frames still fall back to ordinary prose.
Owned streaming previews can show the resulting neutral geometry but never the
unvalidated text, and deletion still clears the preview. No change to
archive formats, actions or previous task policies.

Fresh ordinary task v50 lets models using JSON prompt guidance emit A2UI
messages as native JSON objects in `a2uiFrames`, without double-escaping each
frame as a string. Older string frames still work. Apple native guided schema
generation keeps its string representation; existing historical task
contracts retain their previous grammar. Both representations pass through the
same bounded frame validation and exact answer ownership before a final
surface can appear. This does not add actions, change opt-outs for scoped
records or templates. Fresh v51 replies correct the required v1.0 frame version
in JSON guidance. The owning ChatGPT Plan stream may project only neutral geometry from complete, delimited object frames before publication. Partial or
invalid frames cannot publish answer text or controls.

Fresh ordinary task v52 accepts literal Basic Catalog cross-axis alignment
on a horizontal List: start, center, end, or stretch. The native strip uses
the requested alignment across mixed-height cards, while compact widths and
larger text keep the existing natural stack in answer order. Archive v6
retains the existing read-only horizontal arrangement, not this live
alignment hint. No change to earlier task acceptance or action permissions.

Fresh ordinary task v53 lets a model compose proportionally sized groups by
placing literal weight 1–3 on a Column directly owned by a Row in a single
read-only createSurface without a data model. Wide layouts use the weights;
compact or enlarged-text layouts use the existing natural stack and preserve
all accepted prose. The existing archive keeps the grouping without this
live weight. Earlier versions, actions, and data access are unchanged.

Fresh ordinary task v54 can compose one Basic Catalog Button with a short
literal Text child that also appears in the accepted answer. In a single
final createSurface with temporary controls and no data model, the exact
app-owned reset event with empty context restores this bubble's fields
to their initial values on an explicit tap. Lost or inactive owners
cannot reset another reply. No event, field values, or action authority
goes to the provider or the archive. Older contracts remain unchanged.

Fresh ordinary task v55 also supports a temporary time-only DateTimeInput.
Use a distinct local binding, enableTime: true, and omit enableDate or set
it to false. The field stays empty until explicit native confirmation and
then shows the chosen wall-clock hour and minute. It does not accept
authored bounds, data-model seeds, actions or time zones. The local form
owner retires the value on departure or reset; the existing archived reply
has no picker state or action.

Fresh task v56 retains CheckBox and ChoicePicker selections across tabs
inside the same accepted local form. Only the selected panel is mounted;
inactive panels do not expose controls or receive presses. The exact reply's
Reset button or losing its current owner discards the temporary selections.
Text, sliders, date and time fields keep their previous per-mount behavior.
No value or action is stored, supplied to a provider, or restored.

Fresh task v57 supports the Basic Catalog's `longText` TextField for a
temporary multiline note. It uses the same distinct local binding and
accessible label, starts empty, and accepts up to 256 UTF-16 code units.
Return inserts a newline rather than submitting anything. Ownership loss,
leaving the panel, or Reset discards the note, which never enters the
accepted answer, Copy, the archive or a provider request. Authored values,
other new input variants, and actions are still rejected. Earlier response
versions keep the original single-line input contract.

Fresh task v58 accepts literal ChoicePicker `filterable: true` for local
search across admitted option labels. The case-insensitive query never
selects or clears an option, and typed text never enters Copy, the accepted
answer, storage, or a model request. A panel change, Reset or owner loss
discards the query; selection keeps its existing temporary lifetime.
Authored queries, bound filter flags and actions are not supported.
Earlier versions retain their original grammar.

Fresh task v59 can place weighted Cards beside weighted Columns in a
single final read-only Row. For example, a compact summary card can sit
next to a wider group containing several paragraphs. Only literal
weights from 1 to 3 on already validated direct children of that Row
are allowed; mixed layouts do not use model data or actions. Compact
widths and larger text stack the accepted answer in the same order.
Archive reopening retains the exact read-only grouping without the live
weights; prior task and archive contracts are unchanged.

Fresh task v60 accepts one decorative Basic Catalog `folder` icon in a
static read-only reply. It must immediately precede a body Text in its
own Row or Column, and all answer prose must already match exactly.
The app draws one bundled native symbol, with no extra accessibility
description, action, external resource or model data. Reopening the
reply keeps the archived text and structure without this decoration;
earlier tasks and stored layout decoders cannot accept the new icon.

Fresh task v61 also admits native read-only layouts for ordinary Conversation
replies grounded exclusively in the approved current public-web sources.
The model's tab titles and every panel item must match the existing accepted
answer in order. Citations remain app-owned outside the layout, and the
app's public-web disclosure stays visible regardless of the active panel.
No model action or remote asset is allowed. Cited replies continue to
reopen with the stored prose and original sources, not a retained layout.
Private evidence, templates, partial results and unmatched or omitted UI
frames keep the existing fallback. Earlier tasks retain their original
admission.

Fresh ordinary task v62 lets model-authored temporary CheckBoxes display
their exact unchecked fallback lines as native switches. Each switch owns
one answer line of `☐ ` and its literal label; tab titles, ordinary text
and controls must still consume the full answer in order. Unmatched,
duplicated or reordered content keeps the original plain reply. Toggling
still only changes current local state, and the original fallback and Copy
do not change. No data is sent, stored, or reactivated when reopening a
reply. The public sourced v61 branch keeps its read-only semantics.

Fresh ordinary task v63 can combine exact checklist items with other
already supported temporary controls, such as a notes field and a choice
in separate panels of one reply. CheckBoxes still consume their exact
unchecked fallback lines, and other local controls consume no answer
text. Their owner, limits, reset, and no-storage/no-send behavior stay
unchanged. The accepted answer remains the original prose, and older
responder versions keep their existing contract.

Fresh ordinary task v64 supports the Basic Catalog’s number TextField as
a temporary signed decimal editor. It starts empty, uses the existing
256-character text limit, and can accept a decimal point or comma. Values
remain local to the owned panel; no model value, action, archive, or
submission can use them. Other TextField variants and earlier task
contracts remain unchanged.

Fresh ordinary task v65 can compose a single combined date-and-time picker.
It opens an empty temporary value under the current panel owner, displays
the device’s local date and time, and uses an ISO timestamp only in that
mounted control. Optional exact RFC 3339 instant bounds are supported at
JavaScript Date precision; model seeds, scheduling, outbound events, and
archive restoration remain unsupported. Date-only and time-only behavior
and earlier task contracts are unchanged.

Fresh ordinary task v66 supports literal ChoicePicker `displayStyle: "chips"`:
options appear as wrapping native selection pills. Omission or `"checkbox"`
keeps the vertical layout. Single and multiple selection, optional filtering,
the original answer, and retirement rules are unchanged. Labels and selections
are not sent or archived; no action, link, or external binding is introduced.

Fresh ordinary task v67 can repeat the bundled decorative Basic Catalog
`folder` icon up to three times within one static read-only reply.
Each icon must immediately precede a different accepted body Text in its own
Row or Column. If any placement is invalid, the whole optional layout falls
back to the unchanged answer. The icons are not accessible actions or images,
and are omitted on archive reopening. Earlier versions keep their existing
grammar; no model data, remote assets or actions are added.

Fresh ordinary source-free task v68 supports the pinned collection-local
`@index` system function inside an existing final repeated Text `formatString`.
For example, `Step ${@index(offset: 1)}: ${title}` adds numbers from the owning
collection order, not a property supplied by the model. Omitting `offset`
starts at zero. Only a literal finite offset is accepted; the complete
materialized text still must match the accepted answer in order. Whole-array
replacements use their final order. Provisional surfaces, v67 and earlier,
and sourced replies do not gain this function. Existing archives retain only
eligible static layout/prose, not function expressions or array data.

Fresh ordinary source-free task v69 can bind an existing native CheckBox
to its exact unchecked Markdown fallback line as well as to the existing
square marker. A single literal `- [ ] `, `+ [ ] ` or `* [ ] ` prefix and
the identical label must match the corresponding owned control. The
whole answer still matches in order. Checked markers, extra markup,
reordering, and Markdown lines used as ordinary Text or tab titles are
not admitted as checkboxes. Copy retains the original answer, and the
controls still do not send actions or transfer to the archive. Prior
requests keep their original syntax and behavior.
