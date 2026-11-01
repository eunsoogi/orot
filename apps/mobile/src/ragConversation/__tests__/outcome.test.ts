import type { MultiAgentRunResult } from '@orot/agent-runtime';
import { failureFromWorkflow } from '../outcome';
import type { GroundedRagAnswer } from '../task';

type WorkflowFailure = Exclude<
  MultiAgentRunResult<GroundedRagAnswer>,
  { readonly status: 'result' }
>;

function failure(value: Record<string, unknown>): WorkflowFailure {
  return value as WorkflowFailure;
}

test.each([
  ['authentication_required', 'provider_authentication'],
  ['credential_unavailable', 'provider_authentication'],
  ['rate_limited', 'provider_rate_limited'],
  ['invalid_provider', 'provider_configuration'],
  ['invalid_request', 'provider_configuration'],
  ['duplicate_provider', 'provider_configuration'],
  ['unsupported_capability', 'provider_configuration'],
  ['unsupported_input', 'provider_configuration'],
  ['safety_refusal', 'provider_refused'],
  ['internal_error', 'provider_unavailable'],
  ['provider_unavailable', 'provider_unavailable'],
] as const)(
  'maps provider code %s to a closed recovery category',
  (providerErrorCode, kind) => {
    const outcome = failureFromWorkflow(
      failure({
        status: 'unavailable',
        reason: 'Private provider detail must not reach UI state.',
        providerErrorCode,
        checkpoint: {},
      }),
    );

    expect(outcome).toEqual({ status: 'failure', kind });
    expect(JSON.stringify(outcome)).not.toContain('Private provider detail');
  },
);

test.each([
  ['consent_required', 'consent_required'],
  ['cancelled', 'cancelled'],
  ['invalid_output', 'validation_failed'],
  ['stale_evidence', 'stale_evidence'],
  ['budget_exceeded', 'budget_exceeded'],
  ['unavailable', 'unavailable'],
] as const)(
  'maps workflow status %s to a closed recovery category',
  (status, kind) => {
    expect(
      failureFromWorkflow(
        failure({ status, reason: 'Private workflow detail.', checkpoint: {} }),
      ),
    ).toEqual({ status: 'failure', kind });
  },
);

test('uses task-validated clarification copy to identify the no-evidence outcome', () => {
  expect(
    failureFromWorkflow(
      failure({
        status: 'needs_clarification',
        reason:
          'The task requires clarification before it can return a result.',
        message: 'No current evidence is available.',
        checkpoint: {},
      }),
    ),
  ).toEqual({ status: 'no_evidence' });
});

test('keeps other clarification outcomes separate and private', () => {
  const outcome = failureFromWorkflow(
    failure({
      status: 'needs_clarification',
      reason: 'Private missing-evidence details.',
      message: 'Please narrow the date range.',
      checkpoint: {},
    }),
  );

  expect(outcome).toEqual({ status: 'insufficient' });
  expect(JSON.stringify(outcome)).not.toContain(
    'Private missing-evidence details',
  );
});
