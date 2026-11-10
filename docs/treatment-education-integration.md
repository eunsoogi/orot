# Treatment education integration contract

`explainTreatmentEducation` is an isolated, explicit-request building block. It
selects one existing app-owned statement and sends it through the treatment
safety service, including policy, cancellation, source freshness and the
closed verifier. It does not start a model, retrieve literature, select a
provider, or authorize external transfer. A caller that adds those operations
must use the existing scoped consent and controlled public-evidence interfaces.

The caller supplies the original source-bound treatment context and inventory,
current evidence revalidation, policy actions and cancellation signal. Select
an existing condition by index only after an explicit request. The result is
displayable only when `validated`; use the existing guidance for withheld and
policy results. Never display intermediate provider text. Preserve the
possibility's supporting and contrary references and its uncertain status;
prior AI output is context, not independent evidence. A clinician-attributed
source document is not itself proof of a current clinician plan.

For persistence, pass a complete artifact containing the validated single
claim, its exact citations, context and all source dependencies to
`createTreatmentSafetyService().save`. Reopen through that service before
display or follow-up, and stop if validation fails. Follow-up integration must
bind the reopened artifact's validated context and source revisions to the new
request, recheck consent where applicable, and apply the safety service again.
Generic conversation restoration does not enforce this boundary. The current
API does not implement this follow-up binding or wire the conversation route.

The verifier only accepts its fixed statements. It cannot validate a clinician
plan's contents, personalized advice, condition-specific options, purpose,
monitoring, public-paper findings, or arbitrary model prose. Missing, stale or
conflicting details are not resolved by these statements. The current artifact
format has one citation list per turn, so combining general and separately
source-bound statements cannot safely round-trip in general. Per-claim
provenance and semantic verification require a coordinated contract change;
do not weaken validation to work around this limit. Existing app-owned copy
and guidance still require external clinical review, and provider quality,
native UI, consent and end-to-end integration remain unverified.
