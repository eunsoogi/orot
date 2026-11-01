import { providerFailure } from '@orot/model-runtime';
import { runRagConversationTurn } from '../service';
import type { RagConversationOutcome } from '../service';
import { createConversationSessions } from '../conversationSessions';
import {
  fixture,
  malformed,
  response,
} from '../testSupport/conversationEnvelopeFixtures';

test('rejects citations on an independent conversation without correction', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    response({
      type: 'result',
      value: { answerKind: 'conversation', answer: '답변' },
      citations: ['synthetic-evidence'],
    }),
  );
  const outcome = await runRagConversationTurn(f.options);
  expect(outcome).toMatchObject({
    status: 'failure',
    kind: 'validation_failed',
  });
  await expectNoCommittedAnswer(outcome);
  expect(f.generate).toHaveBeenCalledTimes(1);
});

async function expectNoCommittedAnswer(outcome: RagConversationOutcome) {
  const sessions = createConversationSessions();
  const id = sessions.getSnapshot().activeId;
  sessions.setDraft(id, '기록을 알려 주세요');
  await sessions.send(id, async () => outcome);
  const session = sessions.getSnapshot().sessions.find(item => item.id === id)!;
  expect(session.draft).toBe('기록을 알려 주세요');
  expect(
    session.messages.filter(
      item => item.role === 'assistant' && !item.incomplete,
    ),
  ).toHaveLength(0);
  sessions.dispose();
}

test('never corrects a provider safety refusal', async () => {
  const f = fixture();
  f.generate.mockReset().mockResolvedValueOnce(
    providerFailure({
      code: 'safety_refusal',
      message: 'refused',
      retryable: false,
    }),
  );
  expect(await runRagConversationTurn(f.options)).toEqual({
    status: 'failure',
    kind: 'provider_refused',
  });
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('does not issue a correction when the call budget is exhausted', async () => {
  const f = fixture();
  const workflow = f.options.workflow;
  const outcome = await runRagConversationTurn({
    ...f.options,
    workflow: {
      ...workflow,
      execution: {
        ...workflow.execution,
        budget: { ...workflow.execution.budget, maxModelCalls: 1 },
      },
    },
  });
  expect(outcome).toMatchObject({ status: 'failure', kind: 'budget_exceeded' });
  await expectNoCommittedAnswer(outcome);
  expect(f.generate).toHaveBeenCalledTimes(1);
});

test('does not correct after cancellation or a stale evidence revalidation', async () => {
  const cancelled = fixture();
  const controller = new AbortController();
  cancelled.generate.mockReset().mockImplementationOnce(async () => {
    controller.abort();
    return malformed();
  });
  const cancelledOutcome = await runRagConversationTurn(cancelled.options, {
    signal: controller.signal,
  });
  expect(cancelledOutcome).toMatchObject({
    status: 'failure',
    kind: 'cancelled',
  });
  await expectNoCommittedAnswer(cancelledOutcome);
  expect(cancelled.generate).toHaveBeenCalledTimes(1);

  const stale = fixture();
  stale.generate.mockReset().mockImplementationOnce(async () => {
    stale.revalidateEvidence.mockResolvedValue(false);
    return malformed();
  });
  const staleOutcome = await runRagConversationTurn(stale.options);
  expect(staleOutcome).toMatchObject({
    status: 'failure',
    kind: 'stale_evidence',
  });
  await expectNoCommittedAnswer(staleOutcome);
  expect(stale.generate).toHaveBeenCalledTimes(1);
});

test('never sends or commits a response when consent is denied', async () => {
  const f = fixture();
  f.authorize.mockResolvedValueOnce('denied' as never);
  const workflow = f.options.workflow;
  const outcome = await runRagConversationTurn({
    ...f.options,
    workflow: {
      ...workflow,
      execution: {
        ...workflow.execution,
        remoteProcessing: true,
        recipient: 'remote',
        consentScope: {
          purpose: 'record_conversation',
          dataCategories: ['health_records'],
          policyVersion: 'test',
        },
      },
    },
  });
  expect(outcome).toMatchObject({
    status: 'failure',
    kind: 'consent_required',
  });
  await expectNoCommittedAnswer(outcome);
  expect(f.generate).not.toHaveBeenCalled();
});

test('does not send a correction after consent is withdrawn', async () => {
  const f = fixture();
  f.generate.mockReset().mockImplementationOnce(async () => {
    f.authorize.mockResolvedValue('denied' as never);
    return malformed();
  });
  const workflow = f.options.workflow;
  const outcome = await runRagConversationTurn({
    ...f.options,
    workflow: {
      ...workflow,
      execution: {
        ...workflow.execution,
        remoteProcessing: true,
        recipient: 'remote',
        consentScope: {
          purpose: 'record_conversation',
          dataCategories: ['health_records'],
          policyVersion: 'test',
        },
      },
    },
  });
  expect(outcome).toMatchObject({
    status: 'failure',
    kind: 'consent_required',
  });
  await expectNoCommittedAnswer(outcome);
  expect(f.generate).toHaveBeenCalledTimes(1);
});
