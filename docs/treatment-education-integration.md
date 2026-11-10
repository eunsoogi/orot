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
conversation route uses the local producer through an explicit treatment action.

The conversation action opens a local confirmation sheet for a user-entered
current blood pressure, population and symptoms. The existing policy validates
those inputs before the local dispatcher can open storage for education.
Skipping ends the education request and preserves any guidance already triggered
by the inputs. The form unmounts on submission. The raw input and transient
result stay outside the draft, transcript, model context and retention. With no
topic or source selected, the entry offers the fixed general-options statement.
The source picker offers current
diagnosis records and saved possibilities with complete lineage. A possibility
retains its supporting and contrary references, plus the saved run revision as
an invalidation dependency. The run itself is never a clinical citation.

An explicit save stores the verified claim under the current durable
conversation. Its treatment picker lists metadata for that conversation.
Reopening and follow-up check the same session lease, stored context and
source revisions. Ordinary conversation restoration and model discovery
exclude treatment turns. Deleting the conversation, a source or a saved
parent revokes dependent outputs through the existing storage guards.

Verified local citations open through the existing source detail route. An
explicit tap on a public citation rechecks the owning conversation, saved
answer revision when present, treatment claim and exact retained reference.
The public route opens the original canonical article URL, a single validated
public web result URL, or an exact reviewed education URL. Missing or changed
retained evidence, invalid locators and ambiguous web result lists fail
closed. The app does not fetch a public page to check its current contents
before handing the URL to the operating system.

The source picker and the public hypertension topic are separate. The app
offers the hypertension overview only after the user selects that topic and
passes the same local safety confirmation. Conversation text, measurements
and selected records do not select the topic. The verifier requires the
fixed Korean overview and the exact three public references with their
reviewed metadata:

- [WHO hypertension fact sheet](https://www.who.int/news-room/fact-sheets/detail/hypertension)
  (September 25, 2025) supports healthier eating, physical activity, clinician-led
  medication decisions and the purpose of reducing cardiovascular and kidney harm.
- [WHO guideline for adults with hypertension](https://www.who.int/publications/i/item/9789240033986)
  (August 24, 2021) supports the scope of nonpregnant adults and the discussion
  of treatment benefits and harms.
- [AHA home blood pressure monitoring](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home)
  (reviewed August 14, 2025) supports recording home readings for a clinician
  to review how treatment is working.

The overview is transient. These public references support general education,
and cannot establish a person's diagnosis, treatment choice, dose, blood
pressure target or clinician plan. Record-bound results present verified
record statements separately from app-owned general options and benefits and
risks. They withhold purpose, monitoring and plan contents where the verifier
has no supporting claim.

The verifier only accepts its fixed statements and the explicitly selected
public hypertension overview. It cannot validate a clinician plan's contents,
personalized advice, claims outside the reviewed public profile, or arbitrary
model prose. Missing, stale or conflicting details are not resolved by these
statements. The current artifact
format has one citation list per turn, so combining general and separately
source-bound statements cannot safely round-trip in general. Per-claim
provenance and semantic verification require a coordinated contract change;
do not weaken validation to work around this limit. App-owned copy and
guidance, including the reviewed-source overview, still require clinical
review. Real-model quality and native UI behavior require separate verification.
