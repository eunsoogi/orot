import { runMigrations } from '@orot/storage';
import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createConversationWorkflowContinuationStore } from '../../storage/conversationWorkflowContinuationStore';
import { runContinuableConversationWorkflow } from '../conversationWorkflowContinuation';
const { partitionFixture } = jest.requireActual<{
  partitionFixture(): {
    options: MultiAgentWorkflowOptions;
    requests: LanguageModelRequest[];
  };
}>(
  '../../../../../packages/agent-runtime/__tests__/partitioned-result-fixtures',
);

/** Real SQLite journal and LangGraph checkpoints; only provider responses and approval taps are synthetic. */
async function fixture() {
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const requests = createConversationArtifactStorage(connection.database);
  await requests.createSession('session', await requests.currentGeneration());
  const f = partitionFixture();
  await connection.database.execute(
    "INSERT INTO source_records (id, ingested_at, payload_json) VALUES ('source-0', '2026-11-14T00:00:00Z', '{}')",
  );
  let requestPause = () => {};
  let approvals = 0;
  const consent = {
    authorize: jest.fn(async () => {
      approvals += 1;
      if (approvals === 2) requestPause();
      return 'authorized' as const;
    }),
  };
  const options: MultiAgentWorkflowOptions = {
    ...f.options,
    execution: { ...f.options.execution, remoteProcessing: true },
    consent,
    revalidateEvidence: async () =>
      (
        await connection.database.execute(
          "SELECT id FROM source_records WHERE id = 'source-0'",
        )
      ).rows.length === 1,
  };
  await requests.startRequest({
    id: 'request',
    sessionId: 'session',
    sessionVersion: 0,
    question: options.request,
    createdAt: '2026-11-14T00:00:00.000Z',
  });
  const persisted = await createConversationWorkflowContinuationStore(
    connection.database,
    { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
  );
  const controller = new AbortController();
  return {
    ...f,
    options,
    requestsStore: requests,
    connection,
    persisted,
    controller,
    consent,
    bindPause: (pause: () => void) => {
      requestPause = pause;
    },
  };
}

test('second partition approval resumes the real graph without replaying first partition', async () => {
  const f = await fixture();
  try {
    const waitForContinue = jest.fn(async () => {
      expect(f.requests).toHaveLength(1);
      expect(
        await f.requestsStore.listInterruptedRequests('session', 0),
      ).toEqual([
        expect.objectContaining({ interruptionReason: 'decision-required' }),
      ]);
      const records = (
        await f.connection.database.execute(
          'SELECT status FROM conversation_operation_journal ORDER BY operation_id',
        )
      ).rows;
      expect(records.map(row => row.status)).toEqual(['completed', 'ready']);
      return true; // Explicit synthetic user Continue, never a new send.
    });
    const result = await runContinuableConversationWorkflow(
      f.options,
      { signal: f.controller.signal },
      { persisted: f.persisted, bindPause: f.bindPause, waitForContinue },
    );
    expect(result.status).toBe('result');
    expect(waitForContinue).toHaveBeenCalledTimes(1);
    expect(f.requests).toHaveLength(2);
    expect(f.consent.authorize).toHaveBeenCalledTimes(3);
    if (result.status === 'result')
      expect(result.value).toEqual({ sections: ['evidence-0', 'evidence-1'] });
    expect(JSON.stringify(result.checkpoint)).not.toContain(
      'Synthetic complete facts',
    );
  } finally {
    f.connection.close();
  }
});

test('source removal during approval pause prevents any further dispatch', async () => {
  const f = await fixture();
  try {
    const running = runContinuableConversationWorkflow(
      f.options,
      { signal: f.controller.signal },
      {
        persisted: f.persisted,
        bindPause: f.bindPause,
        waitForContinue: async () => {
          expect(f.requests).toHaveLength(1);
          await f.connection.database.execute(
            "DELETE FROM source_records WHERE id = 'source-0'",
          );
          return true;
        },
      },
    );
    await expect(running).rejects.toThrow('sources');
    expect(f.requests).toHaveLength(1);
    expect(
      (
        await f.connection.database.execute(
          'SELECT result FROM conversation_operation_journal',
        )
      ).rows.every(row => row.result === null),
    ).toBe(true);
  } finally {
    f.connection.close();
  }
});

test('Stop during approval pause retires the same graph without dispatching another partition', async () => {
  const f = await fixture();
  try {
    await runContinuableConversationWorkflow(
      f.options,
      { signal: f.controller.signal },
      {
        persisted: f.persisted,
        bindPause: f.bindPause,
        waitForContinue: async () => {
          await f.requestsStore.interruptRequest(
            'request',
            'session',
            0,
            'interrupted',
            'user-stopped',
          );
          f.controller.abort();
          return false;
        },
      },
    );
    expect(f.requests).toHaveLength(1);
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_operation_journal',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    f.connection.close();
  }
});

test('late approval after Stop cannot dispatch a second partition', async () => {
  const f = await fixture();
  try {
    let approve!: (value: 'authorized') => void;
    let waiting!: () => void;
    const pendingApproval = new Promise<void>(resolve => {
      waiting = resolve;
    });
    let approvals = 0;
    f.consent.authorize.mockImplementation(async () => {
      approvals += 1;
      if (approvals === 1) return 'authorized';
      waiting();
      return new Promise<'authorized'>(resolve => {
        approve = resolve;
      });
    });
    const running = runContinuableConversationWorkflow(
      f.options,
      { signal: f.controller.signal },
      {
        persisted: f.persisted,
        bindPause: f.bindPause,
        waitForContinue: async () => false,
      },
    );
    await pendingApproval;
    await f.requestsStore.interruptRequest(
      'request',
      'session',
      0,
      'interrupted',
      'user-stopped',
    );
    f.controller.abort();
    await running;
    approve('authorized');
    await Promise.resolve();
    expect(f.requests).toHaveLength(1);
  } finally {
    f.connection.close();
  }
});
