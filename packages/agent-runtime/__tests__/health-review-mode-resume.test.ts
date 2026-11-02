import { runHealthReviewGraph } from '../src/health-review/graph';
import type { EvidenceBatch } from '../src/multiAgent/contracts';
import {
  bloodPressureMissing,
  completeEvidence,
  healthReviewModeFixture,
} from './health-review-mode.fixture';

it('uses the freshly assessed clarification input when resuming observation mode', async () => {
  const { options, collect, explain, assessSafety } = healthReviewModeFixture();
  const initial = await runHealthReviewGraph({
    ...options,
    mode: 'record_observation',
    safetyInput: { symptomAssessment: { status: 'unknown' } },
  });
  if (initial.status !== 'needs_clarification') throw new Error('Missing initial safety interrupt');
  collect.mockClear();
  const clarification = {
    symptomAssessment: { status: 'no_new_or_concerning_symptoms' },
  };
  const result = await runHealthReviewGraph({
    ...options,
    mode: 'record_observation',
    safetyInput: { symptomAssessment: { status: 'unknown' } },
    clarification: { pending: initial.pending, safetyInput: clarification },
  });

  expect(result).toMatchObject({ status: 'review', safety: bloodPressureMissing });
  expect(assessSafety).toHaveBeenCalledWith(clarification, expect.any(AbortSignal));
  expect(collect).toHaveBeenCalledTimes(1);
  expect(explain).toHaveBeenCalledTimes(1);
});

it('checks the fresh safety answer before restoring evidence from an evidence pending request', async () => {
  const incomplete: EvidenceBatch = {
    ...completeEvidence,
    coverage: completeEvidence.coverage.map((value) => ({
      ...value,
      gaps: ['no local records'],
    })),
  };
  const { options, collect, explain, assessSafety } = healthReviewModeFixture(incomplete);
  const initial = await runHealthReviewGraph({ ...options, mode: 'record_observation' });
  if (initial.status !== 'needs_clarification') throw new Error('Missing evidence interrupt');
  expect(initial.pending.reason).toBe('evidence');
  expect(initial.pending.references).not.toHaveLength(0);
  collect.mockClear();

  const warningSymptoms = {
    symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
  };
  const result = await runHealthReviewGraph({
    ...options,
    safetyInput: warningSymptoms,
    mode: 'record_observation',
    clarification: { pending: initial.pending, safetyInput: warningSymptoms },
  });

  expect(result).toMatchObject({
    status: 'needs_clarification',
    pending: {
      reason: 'safety_context',
      mode: 'record_observation',
      safety: { missingInputs: ['explicit_symptom_assessment'] },
    },
  });
  expect(assessSafety).toHaveBeenCalledWith(warningSymptoms, expect.any(AbortSignal));
  expect(collect).not.toHaveBeenCalled();
  expect(explain).not.toHaveBeenCalled();
});

it('keeps policy and evidence insufficiency separate in an observation pending snapshot', async () => {
  const incomplete: EvidenceBatch = {
    items: [],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: [],
        gaps: ['no local records'],
        truncated: false,
        resultLimit: 1,
        returnedCount: 0,
      },
    ],
    conflicts: [],
  };
  const { options } = healthReviewModeFixture(incomplete);
  const result = await runHealthReviewGraph({ ...options, mode: 'record_observation' });

  expect(result.status).toBe('needs_clarification');
  if (result.status !== 'needs_clarification') throw new Error('Missing evidence interrupt');
  expect(result.pending.reason).toBe('evidence');
  expect(result.pending.mode).toBe('record_observation');
  expect(result.pending.safety).toEqual(bloodPressureMissing);
});

it('rejects mode changes and pending tampering before collecting restored evidence', async () => {
  const incomplete: EvidenceBatch = {
    ...completeEvidence,
    coverage: completeEvidence.coverage.map((value) => ({
      ...value,
      gaps: ['no local records'],
    })),
  };
  const value = healthReviewModeFixture(incomplete);
  const initial = await runHealthReviewGraph({
    ...value.options,
    mode: 'record_observation',
  });
  if (initial.status !== 'needs_clarification') throw new Error('Missing saved interrupt');
  value.collect.mockClear();
  value.assessSafety.mockClear();

  const changedMode = await runHealthReviewGraph({
    ...value.options,
    mode: 'strict',
    clarification: { pending: initial.pending, safetyInput: value.options.safetyInput },
  });
  expect(changedMode.status).toBe('unavailable');
  expect(value.collect).not.toHaveBeenCalled();
  expect(value.assessSafety).not.toHaveBeenCalled();

  const changedPending = await runHealthReviewGraph({
    ...value.options,
    mode: 'record_observation',
    clarification: {
      pending: { ...initial.pending, mode: 'strict' },
      safetyInput: value.options.safetyInput,
    },
  });
  expect(changedPending.status).toBe('unavailable');
  expect(value.collect).not.toHaveBeenCalled();
  expect(value.assessSafety).not.toHaveBeenCalled();
});

it('returns unavailable for an unknown app-selected mode', async () => {
  const { options, collect, assessSafety } = healthReviewModeFixture();
  const result = await runHealthReviewGraph({
    ...options,
    mode: 'model_selected' as never,
  });

  expect(result).toEqual({ status: 'unavailable' });
  expect(assessSafety).not.toHaveBeenCalled();
  expect(collect).not.toHaveBeenCalled();
});
