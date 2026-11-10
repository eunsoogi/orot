import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { TreatmentExplanationRequest } from '../interfaces';
import { executeTreatmentSafety } from '../treatmentSafetyExecution';

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
const output = {
  claims: [
    {
      text: 'Discuss possible options with a clinician.',
      citations: [reference],
    },
  ],
};

test('holds every stream prefix and validates the full result on every turn', async () => {
  const onTaskStreamEvent = jest.fn();
  const invocation = { onTaskStreamEvent } as unknown as MultiAgentInvocation;
  const generate = jest.fn(async (input: MultiAgentInvocation) => {
    expect(input.onTaskStreamEvent).toBeUndefined();
    return output;
  });
  const verifier = { verify: jest.fn(async () => true) };
  for (let turn = 0; turn < 2; turn++) {
    expect(
      await executeTreatmentSafety(
        invocation,
        generate,
        request,
        verifier,
        new AbortController().signal,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
  }
  expect(verifier.verify).toHaveBeenCalledTimes(2);
  expect(onTaskStreamEvent).not.toHaveBeenCalled();
});

test('does not generate for emergency or cancelled requests', async () => {
  const generate = jest.fn(async () => output);
  const invocation = {} as MultiAgentInvocation;
  const cancelled = new AbortController();
  cancelled.abort();
  expect(
    await executeTreatmentSafety(
      invocation,
      generate,
      request,
      undefined,
      cancelled.signal,
      ['seek_immediate_emergency_help'],
    ),
  ).toMatchObject({ status: 'urgent' });
  expect(
    await executeTreatmentSafety(
      invocation,
      generate,
      request,
      undefined,
      cancelled.signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'cancelled' });
  expect(
    await executeTreatmentSafety(
      invocation,
      generate,
      request,
      undefined,
      new AbortController().signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'unsupported' });
  expect(generate).not.toHaveBeenCalled();
});

test('binds provider cancellation to the same signal used by validation', async () => {
  const controller = new AbortController();
  const generate = jest.fn(async (invocation: MultiAgentInvocation) => {
    expect(invocation.signal).toBe(controller.signal);
    controller.abort();
    return output;
  });
  expect(
    await executeTreatmentSafety(
      {} as MultiAgentInvocation,
      generate,
      request,
      { verify: async () => true },
      controller.signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'cancelled' });
});

test('withholds malformed, rejected and failed generation without exposing text', async () => {
  const invocation = {} as MultiAgentInvocation;
  const signal = new AbortController().signal;
  expect(
    await executeTreatmentSafety(
      invocation,
      async () => ({ text: 'unreviewed' }),
      request,
      { verify: async () => true },
      signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'malformed' });
  expect(
    await executeTreatmentSafety(
      invocation,
      async () => output,
      request,
      { verify: async () => false },
      signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'unsupported' });
  expect(
    await executeTreatmentSafety(
      invocation,
      async () => {
        throw new Error('synthetic');
      },
      request,
      { verify: async () => true },
      signal,
      [],
    ),
  ).toEqual({ status: 'withheld', reason: 'malformed' });
});
