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

The draft implementation adds symptom-summary and possibility discovery to
record conversation, with local source-follow tools and a revalidated source
view. This is not yet a complete consumer matrix: the other retained AI routes,
conversation persistence, research retention, authentic restart and real-model
evidence remain outstanding. A generated result cannot yet be saved as a source
for reviewed visit questions; that boundary remains closed until its lineage and
deletion propagation are implemented.

Newly saved summaries retain every workflow evidence input, including sources
the response did not cite. Older summaries recorded citations only. The shared
catalog identifies those older rows with unknown input lineage, but withholds
their body from cross-feature detail and provider use: an uncited deleted input
cannot be reconstructed or checked. The original summary history remains a
separate compatibility boundary. A safe migration or retention decision is
still needed for those legacy rows; this does not establish their complete
discovery or deletion behavior.

Conversation turns currently lack durable source lineage. Until that lineage is
available, previous assistant prose is withheld from later provider requests;
user questions remain in the bounded history. This protects against resending
an answer after a source is removed, but limits follow-up continuity and does
not remove stale text from an already visible session. Persistence must capture
all evidence supplied to the model, including uncited inputs, and preserve
parent artifact dependencies when following an artifact's source. Citation
lists alone cannot establish that lineage. Writes also need deletion fencing
and an observable retry path before saved turns can be exposed to other features.

The draft includes a conversation-output store in the existing encrypted
database, with session and whole-store deletion fences and source-linked
invalidation. It is not yet connected to the conversation producer, restored
sessions, or shared discovery. Its SQLite tests do not establish native restart
or real-model behavior. Session deletion undo and generated-parent lineage
need integration before this boundary is complete. Memory compaction preserves
outputs when their reviewed source content and metadata remain unchanged.
