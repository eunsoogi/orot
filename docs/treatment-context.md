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

## Preliminary claim verification boundary

`verifyTreatmentClaim` requires a source-bound claim, an independent verifier,
and successful source freshness checks before and after verification. It fails
closed on cancellation, source drift, missing verification, or an exception.
The verifier must inspect the original source content and the claim in context;
the supplied references and model classifications cannot prove semantic support.
No such verifier is supplied here. A successful call is not a complete treatment
safety decision: it does not identify medication instructions, unsupported
diagnoses, urgent symptoms, contraindications, or unsafe streaming prefixes.
Do not use this preliminary function alone to display or persist treatment
explanations. The complete safety boundary, urgent routing, stream buffering,
synthetic evaluation and stored-result enforcement remain release blockers.
