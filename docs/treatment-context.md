# Treatment context contract

The treatment context is an input to education and safety work, not a treatment
selection or a diagnosis. `TreatmentContext` keeps original condition records,
uncertain AI possibilities, clinician-attributed source documents, public
literature, missing information and conflicts in separate fields. Original
record attribution does not establish that its contents are affirmative,
current or clinically correct. A clinician document link does not establish
that the document contains a valid plan. Consumers must inspect the original
source and preserve uncertainty.

Possibilities retain supporting and contrary references and missing data.
Generated outputs are not independent evidence. Medication records, including
manual medication context, cannot be the only personal support. Medication
records alone do not establish diagnosis, current use, adherence or benefit.
These checks establish provenance and source categories, not semantic support
for a claim. The treatment safety owner must validate each claim, including
whether a cited source actually supports it, before display.

Public literature is retrieved through `createTreatmentPublicEvidenceTool`,
which accepts only app-owned topic labels and delegates to the existing Europe
PMC tool's separate query consent. It must not be replaced by a free-form
search port. Its references retain the original URL and dates. Source type,
population, limitations and access are bound to the retrieved reference;
unavailable details stay unknown. An abstract being retrieved does not mean
that full text was retrieved or that the study applies to the person. Existing
model execution consent and evidence revalidation remain separate requirements.

`ConversationRetentionCandidate.treatmentContext` and
`ConversationArtifact.treatmentContext` use the existing conversation output
store. Consumers must include every relevant input in the artifact's source
inventory. Save and `createConversationArtifactStorage(...).read(id)` validate
the same source revisions and deletion boundaries; unavailable or changed
local sources withhold the saved turn. Public literature remains a snapshot
from retrieval time. The existing conversation restoration and
follow-up UI do not yet project this field: the explanation owner must wire it
from the validated storage read and apply the treatment safety boundary before
display. No additional storage or permission is introduced by this contract.

## Treatment safety boundary and release blockers

`verifyTreatmentClaim` requires a source-bound claim, an independent verifier,
and successful source freshness checks before and after verification. It fails
closed on cancellation, source drift, missing verification, or an exception.
The verifier must inspect the original source content and the claim in context;
the supplied references and model classifications cannot prove semantic support.
`createTreatmentClaimVerifier` implements a closed set of app-owned Korean
statements: general treatment categories and benefit/risk uncertainty, a
record-bound clinician discussion question, and carefully attributed
condition-status statements. It rejects all other
prose. Original diagnosis records must still exist with the same revision and
correct origin; AI possibilities retain both supporting and contrary references.
General app-owned text carries no citation, so an unrelated record or article
is not presented as its support. This is a bounded verifier, not open-ended
medical fact checking or evidence that a treatment fits a person.

`evaluateTreatmentOutput` accepts only a
complete, bounded claim envelope, screens recognizable directives and certainty,
requires verification of each claim, and rechecks all citations at the end.
It returns existing immediate-help actions ahead of generated claims. A missing
policy action is not proof that the person is safe: the current policy is narrow
and does not perform comprehensive triage. `bufferTreatmentStream` disables
the task stream callback; consumers must use it before starting generation and
must never project the raw response through another channel.
`executeTreatmentSafety` performs the policy and cancellation checks before
generation, refuses to call a provider when the verifier is missing, and then
buffers and evaluates the complete output for each turn. It does not grant
consent or choose a provider; those remain the caller's existing obligations.
The typed app-owned fallback and immediate-help copy is exposed through
`treatmentSafetyGuidance`; cancellation does not erase a previously established
policy action. The policy action consumer remains responsible for presenting
non-emergency actions.

`createTreatmentSafetyService` binds this verifier to generation, validated
save, and reopen operations. The save operation validates an immutable snapshot
before the existing store checks source revisions in its transaction.
`readValidatedTreatment` reads through the existing artifact storage and
revalidates each saved line and any prior answers retained for follow-up. The
existing artifact has one citation list for
the whole turn, not separate lists per claim: when that loses a claim's exact
binding, verification must withhold the result. A caller must use this path
before displaying or using a saved treatment answer in a follow-up. Existing
generic conversation restore is not an enforcement boundary for this feature.

The lexical screen does not detect every unsafe paraphrase. The closed verifier
must not be replaced with an always-true model or citation-presence check. No
treatment workflow currently connects these interfaces to generation, saved
output, reopening, or follow-up. End-to-end enforcement, clinical review of the
app-owned statements and guidance, and real provider quality evidence remain
release blockers. A disclaimer cannot replace these requirements.
