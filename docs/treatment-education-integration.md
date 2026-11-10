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

`produceTreatmentRequest` accepts an explicit request, reopen, or follow-up.
It returns no text until the closed verifier accepts it. Reopen and follow-up
read the retained artifact from the existing store, validate its prior answers,
and use its original context and source revisions instead of caller-supplied
context. Follow-up rereads and revalidates the artifact after producing its
claim. Optional retention stores the single validated claim with the bound
context and a session version through the existing safety service. A follow-up
must use the original session. The store checks visibility, cancellation and
source freshness; a hidden, deleted or changed source withholds the result.
The recheck is not an atomic lease through later UI display or a later save:
the integrating owner must maintain session lifecycle and source freshness at
those boundaries. Generic conversation restoration withholds treatment turns
until a treatment-aware source-binding path is available.

This producer only selects local app-owned copy; it does not access the model
or literature ports and does not grant, bypass, or request external consent.
Any future external operation must use the existing provider-specific scoped
consent and the separate controlled public-evidence query consent before
transmission, and must still buffer and independently verify output. The
conversation route, provider dispatch and UI are not wired by this module.

`sendExplicitTreatmentMessage` and `treatmentConversationSender` provide a
typed, opt-in dispatcher and map only a verified result or existing urgent
guidance into a conversation outcome. The sender evaluates the existing safety
policy from a caller-supplied structured input; absent information remains an
action to withhold, not an assumed normal measurement. It does not perform
comprehensive triage. They do not interpret ordinary prompts,
send model requests, or commit the answer through the generic conversation
retention observer. The caller must not connect them to the shared screen until
treatment-aware retention, restoration and follow-up dispatch are integrated:
generic restoration currently withholds treatment answers, and an ordinary
follow-up would leave the treatment boundary. The
sender currently provides a partial, in-memory answer; it is not proof of a
complete treatment explanation or a saved conversation.

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
