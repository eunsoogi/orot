import { evaluateTreatmentOutput } from '../treatmentSafetyBoundary';
import type { TreatmentExplanationRequest } from '../interfaces';
import { bufferTreatmentStream } from '../treatmentStreamBoundary';
import type { MultiAgentInvocation } from '@orot/agent-runtime';
import { SafetyPolicyEngine } from '@orot/domain';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'synthetic',
  sourceRevision: '1',
  evidenceId: 'synthetic',
  evidenceRevision: '1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
};
const request = {
  context: {
    version: 1,
    conditions: [],
    clinicianPlans: { status: 'unavailable' },
    publicEvidence: [],
    missingContext: [],
    conflicts: [],
  },
  sources: [{ reference, records: [] }],
  revalidateEvidence: async () => true,
} as unknown as TreatmentExplanationRequest;
const verifier = { verify: jest.fn(async () => true) };
const claim = (text: string) => ({ text, citations: [reference] });
const run = (output: unknown) =>
  evaluateTreatmentOutput(
    output,
    request,
    verifier,
    new AbortController().signal,
    [],
  );

beforeEach(() => verifier.verify.mockClear());

test.each([
  'Stop taking your medication now.',
  'Increase your dose to 10 mg.',
  '이 약을 중단하세요.',
  '약 복용량을 늘리세요.',
  'This treatment will cure you.',
  'You have diabetes.',
])('withholds recognizable harmful advice: %s', async text => {
  expect(await run({ claims: [claim(text)] })).toEqual({
    status: 'withheld',
    reason: 'unsafe',
  });
  expect(verifier.verify).not.toHaveBeenCalled();
});

test('requires complete claims and an independent review of every claim', async () => {
  expect(
    await run({
      claims: [
        claim('Some treatments have benefits and risks.'),
        claim('What options should I discuss with my clinician?'),
      ],
    }),
  ).toMatchObject({ status: 'validated' });
  expect(verifier.verify).toHaveBeenCalledTimes(2);
  expect(
    await run({ claims: [claim('Safe.'), { text: 'Missing citations' }] }),
  ).toEqual({ status: 'withheld', reason: 'malformed' });
  expect(
    await run({ claims: [claim('Safe.')], extra: 'unreviewed prose' }),
  ).toEqual({ status: 'withheld', reason: 'malformed' });
});

test('urgent policy actions take precedence over generated treatment content', async () => {
  expect(
    await evaluateTreatmentOutput(
      { claims: [claim('Stop taking your medication.')] },
      request,
      verifier,
      new AbortController().signal,
      ['seek_immediate_emergency_help'],
    ),
  ).toEqual({ status: 'urgent', actions: ['seek_immediate_emergency_help'] });
  expect(verifier.verify).not.toHaveBeenCalled();
  const actions = [
    'seek_immediate_emergency_help_if_warning_signs_are_present',
    'contact_clinician_promptly',
  ] as const;
  expect(
    await evaluateTreatmentOutput(
      { claims: [claim('Generated content')] },
      request,
      verifier,
      new AbortController().signal,
      actions,
    ),
  ).toEqual({ status: 'urgent', actions });
  expect(
    await evaluateTreatmentOutput(
      { claims: [claim('Generated content')] },
      request,
      verifier,
      new AbortController().signal,
      ['contact_clinician_promptly'],
    ),
  ).toEqual({ status: 'policy', actions: ['contact_clinician_promptly'] });
});

test('routes a real policy decision for a severe synthetic reading and warning sign', async () => {
  const decision = new SafetyPolicyEngine().evaluate({
    population: 'adult_not_pregnant',
    readingContext: 'current_measurement',
    readings: [
      {
        systolicMmHg: 181,
        diastolicMmHg: 121,
        unit: 'mmHg',
        measuredAt: '2026-10-27T08:00:00Z',
        source: 'synthetic',
      },
    ],
    symptomAssessment: { status: 'warning_signs', signs: ['chest_pain'] },
  });
  expect(
    await evaluateTreatmentOutput(
      { claims: [claim('An option may be considered.')] },
      request,
      verifier,
      new AbortController().signal,
      decision.requiredActions,
    ),
  ).toEqual({ status: 'urgent', actions: ['seek_immediate_emergency_help'] });
  expect(verifier.verify).not.toHaveBeenCalled();
});

test('withholds the whole response on unsupported evidence, cancellation, or final source drift', async () => {
  const output = {
    claims: [claim('A general treatment has potential benefits and risks.')],
  };
  expect(
    await evaluateTreatmentOutput(
      output,
      request,
      undefined,
      new AbortController().signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'unsupported' });
  expect(
    await run({
      claims: [
        {
          ...claim('An option exists.'),
          citations: [{ ...reference, sourceRevision: 'changed' }],
        },
      ],
    }),
  ).toEqual({ status: 'withheld', reason: 'unsupported' });
  const controller = new AbortController();
  const cancellingVerifier = {
    verify: async () => {
      controller.abort();
      return true;
    },
  };
  expect(
    await evaluateTreatmentOutput(
      output,
      request,
      cancellingVerifier,
      controller.signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'cancelled' });
  let checks = 0;
  const drifting = { ...request, revalidateEvidence: async () => ++checks < 3 };
  expect(
    await evaluateTreatmentOutput(
      output,
      drifting,
      verifier,
      new AbortController().signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'unsupported' });
});

test('removes the streaming callback before generation begins', () => {
  const onTaskStreamEvent = jest.fn();
  const invocation = {
    onTaskStreamEvent,
    signal: new AbortController().signal,
  } as unknown as MultiAgentInvocation;
  const buffered = bufferTreatmentStream(invocation);
  expect(buffered.onTaskStreamEvent).toBeUndefined();
  expect(buffered.signal).toBe(invocation.signal);
  expect(invocation.onTaskStreamEvent).toBe(onTaskStreamEvent);
});

test.each([
  'This possibility is your confirmed diagnosis.',
  'The medicine is safe during pregnancy.',
  'The two medicines have no interactions.',
  'Your clinician intended you to ignore the other plan.',
  'The cited study proves this treatment will work for you.',
  'This treatment is suitable for your child.',
])(
  'withholds claims the independent semantic reviewer rejects: %s',
  async text => {
    const rejectingVerifier = { verify: jest.fn(async () => false) };
    const result = await evaluateTreatmentOutput(
      { claims: [claim(text)] },
      request,
      rejectingVerifier,
      new AbortController().signal,
      [],
    );
    expect(result.status).toBe('withheld');
  },
);
