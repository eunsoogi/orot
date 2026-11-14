import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import {
  createConversationWorkflowResumeStorage,
  type ConversationResumeManifest,
} from '../conversationWorkflowResumeStorage';
const m: ConversationResumeManifest = {
  requestId: 'r',
  sessionId: 's',
  sessionVersion: 0,
  operationRunId: 'run',
  threadId: 'thread',
  providerId: 'p',
  modelId: 'model',
  recipient: 'p',
  inputIdentity: 'input',
  contextIdentity: 'context',
  scopeIdentity: 'scope',
  approvalIdentity: 'approval',
  budgetIdentity: 'budget',
  workflowVersion: '1',
};
const b = {
  checkpointId: 'c',
  phase: 'revised_response' as const,
  pendingOperation: false,
  terminal: false,
};
async function fixture() {
  const connection = openSqliteTestDatabase(':memory:');
  await runMigrations(connection.database);
  const requests = createConversationArtifactStorage(connection.database);
  await requests.createSession('s', await requests.currentGeneration());
  await requests.startRequest({
    id: 'r',
    sessionId: 's',
    sessionVersion: 0,
    question: 'Synthetic input',
    createdAt: '2026-11-14T00:00:00.000Z',
  });
  let valid = true;
  const make = () =>
    createConversationWorkflowResumeStorage(
      connection.database,
      async () => {},
      async () => valid,
    );
  const resume = make();
  await resume.register(m);
  await resume.saveBoundary(m, b, 0);
  return {
    connection,
    requests,
    resume,
    make,
    invalidate: () => {
      valid = false;
    },
  };
}
test('immutable manifests, durable claims and stale attempts fence duplicate execution', async () => {
  const f = await fixture();
  try {
    await expect(f.resume.register({ ...m, modelId: 'other' })).rejects.toThrow(
      'immutable',
    );
    await f.requests.interruptRequest('r', 's', 0, 'interrupted');
    const claim = await f.resume.claim(m, 'c');
    expect(claim.attempt).toBe(1);
    let writes = 0;
    await f.resume.withClaim(m, claim, async () => {
      writes += 1;
    });
    expect(writes).toBe(1);
    await expect(f.make().claim(m, 'c')).rejects.toThrow('already_claimed');
    await expect(f.resume.saveBoundary(m, b, 0)).rejects.toThrow('Stale');
    await f.resume.saveBoundary(
      m,
      { ...b, checkpointId: 'next' },
      claim.attempt,
    );
    expect(await f.make().eligibility(m, 'c')).toBe('missing_checkpoint');
    expect((await f.make().claim(m, 'next')).attempt).toBe(2);
    await expect(
      f.resume.withClaim(m, claim, async () => {
        writes += 1;
      }),
    ).rejects.toThrow('Stale');
    expect(writes).toBe(1);
    expect(await f.requests.listInterruptedRequests('s', 0)).toHaveLength(1);
  } finally {
    f.connection.close();
  }
});
test('pending remote operations and terminal states explicitly block resume', async () => {
  const f = await fixture();
  try {
    await f.requests.interruptRequest('r', 's', 0, 'interrupted');
    await f.resume.saveBoundary(m, { ...b, pendingOperation: true }, 0);
    await expect(f.resume.claim(m, 'c')).rejects.toThrow(
      'unconfirmed_operation',
    );
    await f.resume.saveBoundary(m, { ...b, terminal: true }, 0);
    expect(await f.resume.eligibility(m, 'c')).toBe('terminal');
  } finally {
    f.connection.close();
  }
});
test('changed input, approval, source revisions fail closed', async () => {
  const f = await fixture();
  try {
    await f.requests.interruptRequest('r', 's', 0, 'interrupted');
    for (const key of [
      'inputIdentity',
      'approvalIdentity',
      'contextIdentity',
      'operationRunId',
    ] as const)
      expect(await f.resume.eligibility({ ...m, [key]: 'changed' }, 'c')).toBe(
        'identity_changed',
      );
    f.invalidate();
    await expect(f.resume.claim(m, 'c')).rejects.toThrow(
      'source_or_approval_invalid',
    );
  } finally {
    f.connection.close();
  }
});
test('deletion purges manifest and blocks late checkpoint writes', async () => {
  const f = await fixture();
  try {
    await f.requests.interruptRequest('r', 's', 0, 'interrupted');
    await f.requests.deleteSession('s');
    expect(await f.resume.eligibility(m, 'c')).toBe('unavailable');
    await expect(f.resume.saveBoundary(m, b, 0)).rejects.toThrow('unavailable');
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_workflow_resumes',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});

test('hidden, replaced and cancelled sessions cannot claim saved work', async () => {
  const f = await fixture();
  try {
    await f.requests.interruptRequest('r', 's', 0, 'interrupted');
    await f.connection.database.execute(
      'UPDATE conversation_artifact_sessions SET hidden = 1 WHERE id = ?',
      ['s'],
    );
    expect(await f.resume.eligibility(m, 'c')).toBe('unavailable');
    await f.connection.database.execute(
      'UPDATE conversation_artifact_sessions SET hidden = 0, version = 1 WHERE id = ?',
      ['s'],
    );
    expect(await f.resume.eligibility(m, 'c')).toBe('unavailable');
    await f.connection.database.execute(
      "UPDATE conversation_requests SET status = 'cancelled' WHERE id = ?",
      ['r'],
    );
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_workflow_resumes',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    f.connection.close();
  }
});

test('external search requires an explicit pre-dispatch tool authorization boundary', async () => {
  const f = await fixture();
  try {
    await f.requests.interruptRequest('r', 's', 0, 'interrupted');
    for (const awaitingAuthorization of [
      undefined,
      'model-1',
      'tool-0',
      'tool-x',
    ]) {
      await f.resume.saveBoundary(
        m,
        { ...b, phase: 'evidence_search', awaitingAuthorization },
        0,
      );
      expect(await f.resume.eligibility(m, 'c')).toBe('missing_checkpoint');
    }
    await f.resume.saveBoundary(
      m,
      {
        ...b,
        phase: 'evidence_search',
        awaitingAuthorization: 'tool-1',
        pendingOperation: true,
      },
      0,
    );
    expect(await f.resume.eligibility(m, 'c')).toBe('unconfirmed_operation');
    await f.resume.saveBoundary(
      m,
      { ...b, phase: 'evidence_search', awaitingAuthorization: 'tool-1' },
      0,
    );
    expect(await f.resume.eligibility(m, 'c')).toBe('eligible');
  } finally {
    f.connection.close();
  }
});
