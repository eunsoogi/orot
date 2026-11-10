# Daily report measurement proposal

## Purpose and status

This proposal describes a local feasibility experiment to see whether an opened
daily reminder is followed by report use. Any implementation needs separate
approval for consent, storage and retention. No measurement has been collected
and no numerical success target is proposed.

The proposed data stays on the device. The existing model-runtime callback
privacy work in #236 covers operational telemetry. Reusing that boundary for
measurement would need separate scope and privacy review.

## Proposed minimum observations

Only after explicit measurement consent, maintain at most one local reminder
journey. The table describes candidate boolean states, not an event stream.
Each state changes at most once per journey. No event includes a timestamp,
identifier, content, source, provider, or health attribute.

| State | Record only when | Does not establish |
| --- | --- | --- |
| Reminder enabled | The person explicitly enables the reminder and the preference is saved. | OS permission, scheduling, or delivery. |
| Notification opened | The app accepts a tap on a delivered daily reminder. | A notification was merely displayed or the person benefited. |
| Generation requested | The person explicitly requests generation while the observed reminder journey is active. | A model call or successful report. |
| Generation completed | That request produces and saves a usable report. | Clinical correctness, user satisfaction, or a later reopen. |
| Saved report reopened | A previously saved report is opened without regeneration during the journey. | That the reminder caused the return. |
| Follow-up entered | The person opens the report's follow-up conversation during the journey. | That a message was sent or answered. |

The enabled state is a separate local preference snapshot, not a requirement
that every later state occurred after a newly enabled reminder. A journey begins
only with an accepted reminder tap. Subsequent states are associated with that
journey locally; an app or conversation entry without such a tap must not be
attributed to a reminder. Repeated taps, concurrent entry, cancellation,
missing saved reports, or a second reminder must not silently create duplicate
completions. If the association is ambiguous, leave the state unknown rather
than count it as false or assign it to a different journey. A future design must
specify the precise concurrency and completion boundary before collection.

For a bounded feasibility experiment, the proposed upper limit is 24 hours
after the accepted tap, with one expiry deadline stored locally only to enforce
deletion. This duration is a proposal, not an approved product decision. The
deadline is not an analytics event, report date, or source time, but it can
reveal the approximate tap time and must have the same protection and deletion
rules as the states. At expiry, discard the entire journey. Do not retain
per-day history, install IDs, session IDs, report IDs, device identifiers,
precise event times, or cross-device links.
These short-lived states can show which actions occurred after the tap, but do
not establish the order of those actions. They cannot measure population
conversion, long-term retention, causal impact, or whether a report was useful.
Those questions remain unmeasured without a separately approved method.

## Consent, storage, and deletion

Measurement is off by default. A separate, informed opt-in must describe the
purpose, exact local states, proposed lifetime, local-only handling, and how to
withdraw. Notification permission, enabling reminders, provider selection,
and consent to send health data to a provider are not measurement consent.
Declining or withdrawing measurement must not disable reminders, report access,
or conversation. Consent withdrawal stops new observations immediately and
deletes the local measurement state and expiry deadline, including any local
derived counts. No retrospective events are reconstructed after opt-in.

Until a retention duration, storage method, and deletion behavior are
approved, do not persist or collect these measurements. If persistence is
later approved, use the existing encrypted local storage boundary and exclude
the measurement state from backups, logs, crash reports, and exports. Delete it
on expiry, withdrawal, and an explicit measurement-data deletion request;
deletion must also clear in-memory copies and any derived local state. Where
the OS cannot guarantee physical erasure from storage media, describe logical
deletion accurately. The implementation must prove that a restart cannot
restore deleted measurement state. Deleting a report or source must retain
the existing report and source deletion guarantees; measurement must not keep
their identifiers, content, or copies.

Never record health text, conditions, source or report identifiers, prompts,
report text, model output, account or device identifiers, or notification
payloads in this measurement. The permitted values remain potentially
sensitive behavioral data even without those fields. Avoid small-cell exports,
user-level linkage, and reidentification; this proposal permits no export at
all. If local encryption, backup exclusion, deletion, or consent enforcement
cannot be demonstrated, leave collection disabled.

## Separate acceptance evidence

[Integrated validation](../../ios-validation.md#070-integrated-daily-report)
records the controlled route and SQLite checks, including a positive control
for explicit generation and zero calls at the observed boundaries during
viewing. Native reminder scheduling, delivery and tap remain unverified.
Any future collection should keep native, controlled-model and actual-provider
observations separate. The proposed local states provide no measured outcome.
