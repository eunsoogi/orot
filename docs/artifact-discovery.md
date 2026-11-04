# Retained material and AI output discovery

This is the working coverage map for the shared discovery contract. The baseline
is source inspection at `79456719f3dbe37280709df3d2f7487525f68c14`; entries do
not claim that cross-feature retrieval or a model execution has passed. The
matrix must be updated with implementation and revision-scoped evidence before
the contract is considered complete.

| Producer or material                        | Authoritative storage at baseline                                                             | Existing AI access at baseline                                                                        | Remaining coverage                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Imported document and extracted text        | `source_records`, `evidence_spans` and protected original file                                | Personal-record search selects evidence spans; source rows are dependencies.                          | Verify original and text discovery, detail, deletion and cross-feature paths.                                           |
| Recording and transcript                    | Protected recording file, `source_records`, `transcript_segments`                             | Personal-record search selects current transcript segments.                                           | Verify source-only recordings and revision/deletion handling across consumers.                                          |
| User-entered history                        | `manual_history_entries` and correction lineage                                               | Personal-record search uses current manual-history evidence.                                          | Verify pagination, source revision and deletion through every consumer.                                                 |
| Synchronized or manual health records       | Structured record tables, including `health_observations`, `encounters` and `symptom_entries` | Personal-record search and health-context tools select bounded records.                               | Verify each retained type, including historical symptom data after feature removal.                                     |
| Medications and dose history                | `medication_definitions`, `medication_assertions`, `dose_events`                              | Personal-record search and health-context tools select bounded records.                               | Verify distinct definitions, assertions and dose events across consumers.                                               |
| Appointments                                | `appointments`                                                                                | Personal-record search and visit-question context.                                                    | Verify detail and lifecycle propagation across consumers.                                                               |
| Reviewed visit questions and briefs         | `visit_questions`, `visit_briefs`; reviewed question memory may also be retained              | Structured personal-record search; reviewed memory search.                                            | Verify each producer and distinguish reviewed questions from generated drafts.                                          |
| Symptom summaries and disease possibilities | `symptom_summary_runs`, with source and period dependency tables                              | Summary history restores saved results; shared personal-record catalog does not enumerate this table. | Add discovery and source validation without treating generated interpretation as clinical fact.                         |
| Record conversations                        | App-owned memory-only conversation sessions                                                   | Current session history is supplied to conversation; it is not durable across process restart.        | Persist eligible completed turns and useful partial results; previously lost memory-only turns cannot be reconstructed. |
| Medical research and sources                | Run-local Europe PMC and public-web references; saved summaries can retain references         | Research tools and references are scoped to a run; summary history can restore its saved references.  | Inventory other retained research paths and persist eligible results with their original sources.                       |
| Reviewed agent memory                       | `agent_memory_records` and source-removal records                                             | Reviewed-memory search.                                                                               | Verify current source validity, pagination and deletion across consumers.                                               |
| Graph checkpoints                           | `langgraph_checkpoints`, `langgraph_checkpoint_writes` and source links                       | Workflow recovery, not a general artifact catalog.                                                    | Determine retained user-visible outputs separately from transient workflow state.                                       |

A focused integration test saves a reviewed visit question through the existing
save operation, reopens its SQLite file, and exercises the record-conversation
search and source-read paths. It also checks that deleting the question revokes
the source read. The test uses a synthetic workflow runner and ranking port; it
does not establish native SQLCipher restart, real-model selection or cross-feature
coverage beyond that path.

## Required contract

Discovery must read authoritative encrypted stores or rebuildable projections,
return bounded and pageable results, and support an exact detail read. Identity
must include the actual artifact type and stable local identifier. Metadata must
retain available origin, creation and event times, revision, provider and model,
completion and review state, and source references; unknown legacy fields stay
unknown. A generated interpretation is identified as historical AI output, not
as independently verified source evidence.

Every detail read must revalidate source revisions and deletion state. A changed
or unavailable dependency must be marked or invalidated according to its
retention rule; deleting source material must not resurrect derived private text
through an index or another saved output. New writes must distinguish completed,
useful partial and failed or cancelled work, retain explicit user review for
editable clinical drafts, and make failed writes recoverable. Consent and public
search boundaries remain separate from local discovery.

The retained AI consumers to cover are record conversation, symptom summary,
disease-possibility analysis and visit-question generation. Health Review and
Symptom Journal are being removed separately; this contract must preserve their
retained shared data without restoring their entry points. Combined final
feature and physical-device acceptance belongs to the integration issue.

The draft connects symptom-summary, possibility and retained conversation
discovery and local source-follow tools to record conversation, symptom summary,
disease-possibility analysis and visit-question generation. Generated results
remain labeled as historical AI output. New reviewed questions preserve their
generated parents, including uncited generated inputs, and source invalidation
propagates through retained descendants. Saved visit-question history restores
generated parents as earlier AI context with revision checks. Saved questions
do not distinguish directly cited generated parents from uncited generated
context, so generated-only saved questions cannot be edited as cited drafts
without regeneration. Saved summaries and conversation turns can be found using
retained public research titles and
expose validated public source links as historical metadata. Standalone research
snapshots are stored in the same encrypted database and exposed through a local
research tool. Europe PMC snapshots retain citation metadata and the original
link, not abstract text; public-web snapshots retain the generated explanation
and its cited links as historical AI output. Free-form results retain the local
inputs available to the query; conversation results additionally require a
durable session so deletion can remove text derived from the conversation.
When this lineage is unavailable the result remains run-local and its coverage
reports the retention gap. Local SQLite tests cover search,
detail, deletion and selected derived artifacts, but do not establish native
restart or real-model use. Authentic
restart, real-model evidence and integration acceptance remain outstanding.

Newly saved summaries retain every workflow evidence input, including sources
the response did not cite. Older summaries recorded citations only. The shared
catalog identifies those older rows with unknown input lineage, but withholds
their body from cross-feature detail and provider use: an uncited deleted input
cannot be reconstructed or checked. The original summary history remains a
separate compatibility boundary. The original stored row is preserved while
its input lineage is unknown, and local history does not restore its body.
This does not establish complete discovery for those legacy rows.

For a text query, cross-feature search now reports a query-independent
coverage gap when its page contains older summaries with unknown lineage. It
does not return their identities, timestamps, sources or text as search items:
their association with a deleted input cannot be ruled out. This notice is
not an item-level discovery or detail-read solution. Local history displays a
notice in place of opening an unknown-lineage result. Neither inventing source
links nor treating the available citation list as complete can safely backfill
the missing lineage.

Newly retained conversation turns can record admitted source lineage, including
exact retained summary, conversation and research parents and their underlying
sources. Other generated-parent types are not yet supported. Previous assistant prose is
therefore withheld from later provider requests;
user questions remain in the bounded history. This protects against resending
an answer after a source is removed, but limits follow-up continuity and does
not remove stale text from an already visible session. Persistence must capture
all evidence supplied to the model, including uncited inputs, and preserve
parent artifact dependencies when following an artifact's source. Citation
lists alone cannot establish that lineage. Writes also need deletion fencing
and an observable retry path before saved turns can be exposed to other features.

The draft includes a conversation-output store in the existing encrypted
database, with session and whole-store deletion fences and source-linked
invalidation. The app route now supplies retention callbacks so validated
answers are saved, failed writes can be retried, and a session can be restored
with freshly revalidated source links when its durable identity is attached.
The history screen still lists only sessions created in the current process; it
does not yet enumerate durable sessions after restart. The record-conversation
tool can page and read saved turns across sessions with revalidated source
links. SQLite tests do not establish native restart or real-model behavior.
Visible cached text invalidation and durable-session enumeration need
integration before this boundary is complete. Memory compaction
preserves outputs when their reviewed source content and metadata remain
unchanged.
Validated conversation answers can declare that they address only part of a
request; that status is displayed and retained with the answer. Uncommitted
streaming text and cancelled attempts are not saved as artifacts. Whether a
model identifies a partial answer accurately still requires real-model evidence.
The native SQLite binding exposes update and transaction hooks, but dispatches
their callbacks asynchronously to JavaScript. They cannot by themselves fence
visible cached text at the instant a source changes or prove callback delivery
before another operation completes. A production invalidation path must cover
all source writers and restore while preserving transaction and failure behavior.
The binding queues transactions but allows top-level execution on the same
connection while a transaction is open. A notification attached only to the
top-level call can therefore precede commit or report a change later rolled
back. SQL transaction control can also bypass a wrapper around typed commit
methods. The mutation boundary must account for both behaviors before cached
conversation text is enabled for durable restoration.
The write adapter can retry an unchanged candidate without another model call.
Cancellation before its last transactional check rolls back the write; after
that point a successful commit wins. The screen must retain request ownership
until that outcome is known and discard pending retries on deletion or clear.

## Cross-kind deletion identity

Artifact identities pair a type with an ID, and exact record dependencies pair
a record kind with an ID. The legacy symptom removal path now has a dedicated
symptom tombstone and kind-aware memory and retrieval handling. It quarantines
ambiguous legacy memory rather than treating an untyped reference as proof of a
different kind. Its tests cover interrupted removal and unrelated records with
the same ID.

This does not yet establish a typed deletion contract for every artifact. Other
source and memory tombstones and some local aliases still use untyped IDs.
Those boundaries and existing backup data need compatible handling before
cross-kind deletion safety can be claimed across all producers and consumers.
