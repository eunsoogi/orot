import { MemorySaver } from '@langchain/langgraph/web';
import { createMultiAgentPauseController, runMultiAgentWorkflow } from '../src';
import { partitionFixture } from './partitioned-result-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

function fixture(pauseAt: number) {
  const f = partitionFixture();
  const pause = createMultiAgentPauseController();
  let approvals = 0;
  const consent = {
    authorize: jest.fn(async () => {
      approvals += 1;
      if (approvals === pauseAt) pause.requestPause();
      return 'authorized' as const;
    }),
  };
  const { journal, records } = operationJournalFixture();
  const options = {
    ...f.options,
    execution: { ...f.options.execution, remoteProcessing: true },
    consent,
    checkpointer: new MemorySaver(),
    operationJournal: journal,
    restoreEvidence: async () => f.options.initialEvidence,
  };
  const config = { configurable: { thread_id: 'synthetic-approval-pause' } };
  return { ...f, pause, options, config, consent, records };
}

test('approval pause saves a safe graph boundary before dispatch and requests a fresh approval on resume', async () => {
  const f = fixture(1);
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first.status).toBe('paused');
  expect(first.checkpoint.awaitingAuthorization).toBe('model-1');
  expect(first.checkpoint.pendingOperation).toBeUndefined();
  expect(f.requests).toHaveLength(0);
  const second = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(second.status).toBe('result');
  expect(f.requests).toHaveLength(2);
  expect(f.consent.authorize).toHaveBeenCalledTimes(3);
});

test('a completed first partition is neither reauthorized nor dispatched when second-partition approval resumes', async () => {
  const f = fixture(2);
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first.status).toBe('paused');
  expect(f.requests).toHaveLength(1);
  const second = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(second.status).toBe('result');
  expect(f.requests).toHaveLength(2);
  expect(f.consent.authorize).toHaveBeenCalledTimes(3);
  if (second.status === 'result')
    expect(second.value).toEqual({ sections: ['evidence-0', 'evidence-1'] });
  expect(JSON.stringify(second.checkpoint)).not.toContain('Synthetic complete facts');
});

test('changed source revisions reject the saved approval boundary without new dispatch', async () => {
  const f = fixture(2);
  expect(
    (await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause })).status,
  ).toBe('paused');
  f.options.revalidateEvidence = async () => false;
  expect((await runMultiAgentWorkflow(f.options, { config: f.config })).status).toBe(
    'stale_evidence',
  );
  expect(f.requests).toHaveLength(1);
});

test('an uncertain dispatch intent cannot be replayed through an approval checkpoint', async () => {
  const f = fixture(1);
  expect(
    (await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause })).status,
  ).toBe('paused');
  f.records.get('model-1:call-1')!.state = { status: 'pending' };
  expect((await runMultiAgentWorkflow(f.options, { config: f.config })).status).toBe('unavailable');
  expect(f.requests).toHaveLength(0);
  expect(f.consent.authorize).toHaveBeenCalledTimes(1);
});

test('explicit Stop during approval is cancellation, not a resumable pause', async () => {
  const f = fixture(99);
  const stop = new AbortController();
  f.consent.authorize.mockImplementation(async () => {
    stop.abort();
    return 'authorized';
  });
  const result = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: f.pause,
    signal: stop.signal,
  });
  expect(result.status).toBe('cancelled');
  expect(result.checkpoint.awaitingAuthorization).toBeUndefined();
  expect(f.requests).toHaveLength(0);
});

test('photo approval uses the same cancellable no-dispatch boundary and is requested anew', async () => {
  const f = fixture(99);
  let count = 0;
  const photoConsent = {
    authorize: jest.fn(async () => {
      count += 1;
      if (count === 1) f.pause.requestPause();
      return 'authorized' as const;
    }),
  };
  const options = {
    ...f.options,
    execution: {
      ...f.options.execution,
      consentScope: {
        purpose: 'record_conversation' as const,
        policyVersion: 'v1',
        dataCategories: ['photo_ocr' as const],
      },
    },
    photoInput: { evidenceIds: ['evidence-0'], consent: photoConsent },
  };
  const first = await runMultiAgentWorkflow(options, { config: f.config, pause: f.pause });
  expect(first.status).toBe('paused');
  expect(f.requests).toHaveLength(0);
  expect(f.consent.authorize).toHaveBeenCalledTimes(0);
  const second = await runMultiAgentWorkflow(options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(second.status).toBe('result');
  expect(f.requests).toHaveLength(2);
  expect(photoConsent.authorize).toHaveBeenCalledTimes(3);
});
