import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { persistEncounterApproval } from '../../agent/encounter/persistence';
import { createEncounterReviewSessions } from '../../agent/encounter/reviewSession';
import { createLangGraphCheckpointStorage } from '@orot/storage';

import {
  sqliteReviewFixture,
  sourceId,
  consent,
} from '../__fixtures__/sqliteReview';
const {
  controllerFor,
  repository,
  rows,
  reopen,
  database,
  openSecondConnection,
  seedSource,
} = sqliteReviewFixture();

test('source discovery survives closed database and fresh controller without re-extraction or approval', async () => {
  const first = controllerFor();
  await first.controller.restore();
  expect(first.controller.state.status).toBe('idle');
  expect(first.synthetic.calls()).toBe(0);
  await first.controller.start(consent);
  const original = first.controller.state.pending;
  expect(original?.sourceId).toBe(sourceId);
  expect(first.synthetic.calls()).toBe(1);
  expect(await rows()).toHaveLength(0);
  first.controller.dispose();
  reopen();
  const second = controllerFor(false, false);
  await second.controller.restore();
  expect(second.controller.state.pending).toEqual(original);
  expect(second.synthetic.calls()).toBe(0);
  expect(await rows()).toHaveLength(0);
  second.controller.edit('candidate-0', 'text', '사용자가 검토한 내용');
  second.controller.edit('candidate-0', 'dosageInstruction', '');
  await second.controller.decide('approve');
  expect(second.controller.state.status).toBe('saved');
  expect(await rows()).toHaveLength(2);
  expect(
    (await rows()).find(
      record => record.concept === 'encounter_medication_statement',
    )?.value,
  ).toEqual({ kind: 'text', text: '사용자가 검토한 내용' });
  expect(
    (await rows()).every(
      record =>
        record.reviewState.status === 'reviewed' &&
        record.provenance.origin === 'derived',
    ),
  ).toBe(true);
  const third = controllerFor(false, false);
  await third.controller.restore();
  expect(third.controller.state.status).toBe('saved');
});

test.each([':review', ':ui-review'])(
  'native-shaped %s source uses a private execution ID and waits for approval',
  async suffix => {
    const nativeSourceId =
      'test-persistence-00000000-0000-4000-8000-000000000001' + suffix;
    await seedSource(nativeSourceId);
    const { controller, synthetic } = controllerFor(true, true, nativeSourceId);
    const authorized = {
      authorize: jest.fn(async () => 'authorized' as const),
    };

    await controller.start(authorized);
    expect({
      status: controller.state.status,
      modelCalls: synthetic.calls(),
      records: await rows(),
    }).toEqual({ status: 'pending', modelCalls: 1, records: [] });

    const pending = controller.state.pending!;
    const discovery = createEncounterReviewSessions(
      createLangGraphCheckpointStorage(database(), {
        sourceRecordId: nativeSourceId,
      }),
      nativeSourceId,
    );
    const session = await discovery.read();
    const threadPrefix =
      'encounter-review-session:' + encodeURIComponent(nativeSourceId) + ':';
    expect(session?.threadId).toBe(pending.threadId);
    expect(pending.threadId.startsWith(threadPrefix)).toBe(true);
    expect(pending.threadId).toContain('%3A');

    const executionId =
      'encounter-extraction-' + pending.threadId.slice(threadPrefix.length);
    expect(executionId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(executionId).not.toContain(nativeSourceId);
    expect(executionId).not.toContain('%');
    expect(authorized.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        operationRunId: executionId,
        allowedScope: {
          sourceKinds: ['personal_record'],
          sourceIds: [nativeSourceId],
        },
      }),
    );

    await controller.decide('approve');
    const saved = await rows();
    expect(controller.state.status).toBe('saved');
    expect(saved).toHaveLength(2);
    expect(
      saved.every(record =>
        record.provenance.sourceRecordIds.includes(nativeSourceId),
      ),
    ).toBe(true);
    expect(synthetic.calls()).toBe(1);
  },
);

test('denied transmission never calls the provider; exact single-source scope is disclosed', async () => {
  const { controller, synthetic } = controllerFor(true);
  const denied = {
    authorize: jest.fn(async () => 'renewal_required' as const),
  };
  await controller.start(denied);
  expect(controller.state.status).toBe('consent-denied');
  expect(synthetic.calls()).toBe(0);
  expect(await rows()).toHaveLength(0);
  expect(denied.authorize).toHaveBeenCalledWith(
    expect.objectContaining({
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: [sourceId] },
      modelId: 'synthetic',
      recipient: 'selected-account',
    }),
  );
});

test('rejection writes nothing and a deliberate new attempt gets a different discoverable identity', async () => {
  const { controller } = controllerFor();
  await controller.start(consent);
  const first = controller.state.pending!.threadId;
  await controller.decide('deny');
  expect(controller.state.status).toBe('denied');
  expect(await rows()).toHaveLength(0);
  await controller.start(consent);
  expect(controller.state.pending!.threadId).not.toBe(first);
});

test('correction and logical deletion fence stale approval and remove discovery without late resurrection', async () => {
  const { controller, service } = controllerFor();
  await controller.start(consent);
  const pending = controller.state.pending!;
  const segment = (
    await repository().transcripts.listForRecording(sourceId)
  )[0];
  await repository().transcripts.correct(
    segment.id,
    '수정한 전사',
    '2035-01-03T00:00:00Z',
  );
  await controller.decide('approve');
  expect(controller.state.status).toBe('unavailable');
  expect(await rows()).toHaveLength(0);
  await new SqlCipherAgentMemoryStorage(database()).markSourceRemoved(sourceId);
  expect(await service.restore(sourceId, new AbortController().signal)).toEqual(
    { status: 'unavailable' },
  );
  expect(
    await service.decide(
      sourceId,
      {
        pending,
        decision: 'approve',
        candidates: pending.candidates,
        reviewerId: 'local-user',
        reviewedAt: new Date().toISOString(),
      },
      new AbortController().signal,
    ),
  ).toEqual({ status: 'unavailable' });
  expect(await rows()).toHaveLength(0);
});

test('another database connection replaces a preview attempt before approval enters its write transaction', async () => {
  const first = controllerFor();
  await first.controller.start(consent);
  const pending = first.controller.state.pending!;
  // A already read the descriptor. B replaces it through a separate connection before A commits.
  const other = openSecondConnection();
  try {
    await createEncounterReviewSessions(
      createLangGraphCheckpointStorage(other.database, {
        sourceRecordId: sourceId,
      }),
      sourceId,
    ).begin();
    await expect(
      persistEncounterApproval(
        repository(),
        pending,
        {
          pending,
          decision: 'approve',
          candidates: pending.candidates,
          reviewerId: 'local-user',
          reviewedAt: new Date().toISOString(),
        },
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow('replaced');
    expect(await rows()).toHaveLength(0);
    expect(
      await repository().evidenceSpans.listForSourceRecord(sourceId),
    ).toHaveLength(0);
  } finally {
    other.close();
  }
});
