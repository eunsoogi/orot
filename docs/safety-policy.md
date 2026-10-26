# Local safety policy

## Initial rule set

Policy version `1.0.0` contains one deterministic rule for a deliberately narrow
case: current blood-pressure readings for an adult known not to be pregnant.
The policy schema stores a version, source, source review date, local review
date, applicability statement, required inputs, and thresholds for every rule.

The initial rule uses the American Heart Association's severe-range threshold:
systolic pressure higher than 180 mmHg or diastolic pressure higher than 120
mmHg. A confirmed listed warning sign with a current severe-range reading
returns immediate-help guidance. If no new or concerning symptoms are confirmed,
one severe-range reading asks for a repeat after at least 60 seconds; a repeat
that remains severe asks the person to contact a health care professional as
soon as possible. When the reading or symptom context is missing, the result
retains that uncertainty and does not convert missing information into an
absence of symptoms.

The locally reviewed warning-sign inputs are chest pain, shortness of breath,
back pain, numbness, weakness, vision change, and difficulty speaking. They are
structured inputs; the engine does not inspect symptom descriptions or infer
symptoms from model output. If a repeated severe-range reading lacks confirmed
symptom status, the policy asks for that information and retains clinician
contact, with conditional immediate-help guidance if a listed warning sign is
present.

The source page says to call 911 in its U.S. guidance. The engine returns the
country-neutral action `seek_immediate_emergency_help`; a caller must provide
the appropriate local emergency contact details. The engine does not diagnose,
recommend medication changes, or describe a non-triggered result as proof that a
person is safe.

## Applicability and limits

The rule requires a current measurement, mmHg units, a timestamp, a source, and
an explicit symptom assessment. A repeat must be taken at least 60 seconds
after the prior reading before the persistent-reading branch can request
clinician contact. Incomplete measurement data routes to verification. A
historical reading, unknown population, pregnancy, childhood, unstructured
symptoms, and conditions outside this rule remain insufficient information.

This initial rule set is not comprehensive emergency detection. It does not
evaluate warning symptoms without a severe-range blood-pressure reading, other
measurements, or free-text complaints. A result with no matched rule must not be
used as reassurance or as a replacement for professional judgment. Graph
ordering and user clarification belong to the consuming workflow in issue #29.

## Source and review

- Source: [American Heart Association, When To Call 911 About High Blood
  Pressure](https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/when-to-call-911-for-high-blood-pressure).
- Source page last reviewed: 2025-08-14.
- Local policy reviewed: 2026-10-27.
- Tests use synthetic values and identifiers only. The engine returns action
  codes and policy identifiers; it does not log or persist input readings,
  symptoms, or source identifiers.
