import { createLangGraphCheckpointStorage } from '@orot/storage';
import {
  sqliteEncounterFixture,
  sourceId,
  approvalFor,
} from '../../agent/encounter/__fixtures__/sqliteFixture';
import {
  createEncounterReviewSessions,
  requireCurrentEncounterReviewSession,
} from '../../agent/encounter/reviewSession';
import { persistEncounterApproval } from '../../agent/encounter/persistence';
import { seedSyntheticEncounter } from '../../agent/encounter/syntheticFixture';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';

const fixture = sqliteEncounterFixture();
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (bytes: Uint8Array) =>
        require('node:crypto').randomFillSync(bytes),
    },
  });
});
const storage = () =>
  createLangGraphCheckpointStorage(fixture.database(), {
    sourceRecordId: sourceId,
  });
const sessions = () => createEncounterReviewSessions(storage(), sourceId);

test('execution identity is stable per validated attempt and independent of checkpoint length', async () => {
  const longSourceId = 'private-source-' + 'a'.repeat(160) + ':review';
  await seedSyntheticEncounter(fixture.repository(), longSourceId);
  const discovery = createEncounterReviewSessions(
    createLangGraphCheckpointStorage(fixture.database(), {
      sourceRecordId: longSourceId,
    }),
    longSourceId,
  );
  const first = await discovery.begin();
  const prefix =
    'encounter-review-session:' + encodeURIComponent(longSourceId) + ':';

  // Checkpoint identity remains source-bound even when it exceeds the workflow ID limit.
  expect(first.threadId.length).toBeGreaterThan(128);
  const firstExecutionId = discovery.executionId(first);
  expect(firstExecutionId).toBe(
    'encounter-extraction-' + first.threadId.slice(prefix.length),
  );
  expect(firstExecutionId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  expect(firstExecutionId).not.toContain(longSourceId);

  const restored = await discovery.read();
  expect(restored).toEqual(first);
  expect(discovery.executionId(restored!)).toBe(firstExecutionId);
  const next = await discovery.begin();
  expect(discovery.executionId(next)).not.toBe(firstExecutionId);
});

test('execution identity rejects mismatched, malformed, or wrong-length descriptors without echoing source data', async () => {
  const privateSourceId = 'private-source-sentinel:review';
  await seedSyntheticEncounter(fixture.repository(), privateSourceId);
  const discovery = createEncounterReviewSessions(
    createLangGraphCheckpointStorage(fixture.database(), {
      sourceRecordId: privateSourceId,
    }),
    privateSourceId,
  );
  const session = await discovery.begin();
  const prefix =
    'encounter-review-session:' + encodeURIComponent(privateSourceId) + ':';
  const invalid: unknown[] = [
    { ...session, sourceId: 'another-source' },
    { ...session, threadId: prefix + 'a'.repeat(31) },
    { ...session, threadId: prefix + 'a'.repeat(33) },
    { ...session, threadId: prefix + 'g'.repeat(32) },
    { ...session, unexpected: true },
  ];

  for (const value of invalid) {
    let thrown: unknown;
    try {
      discovery.executionId(value as typeof session);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Invalid recording review session.');
    expect((thrown as Error).message).not.toContain(privateSourceId);
    expect((thrown as Error).message).not.toContain(session.threadId);
  }
});

test('malformed descriptor versions and encodings fail before a write or discovery result', async () => {
  const session = await sessions().begin();
  const stored = await storage().loadCheckpoint(
    'encounter-review-session:' + encodeURIComponent(sourceId),
    '',
    'session',
  );
  for (const invalid of [
    { ...stored!, checkpointType: 'opaque' },
    {
      ...stored!,
      checkpoint: new TextEncoder().encode(
        JSON.stringify({ ...session, version: 2 }),
      ),
    },
    {
      ...stored!,
      checkpoint: new TextEncoder().encode(
        JSON.stringify({ ...session, sourceId: 'other-source' }),
      ),
    },
  ]) {
    await storage().saveCheckpoint(
      'encounter-review-session:' + encodeURIComponent(sourceId),
      '',
      invalid,
    );
    await expect(sessions().read()).rejects.toThrow();
    await expect(
      fixture
        .repository()
        .transaction(async (_writer, sql) =>
          requireCurrentEncounterReviewSession(
            sql!,
            sourceId,
            session.threadId,
          ),
        ),
    ).rejects.toThrow();
  }
  await storage().saveCheckpoint(
    'encounter-review-session:' + encodeURIComponent(sourceId),
    '',
    {
      ...stored!,
      checkpoint: new TextEncoder().encode(
        'malformed ' + sourceId + ' ' + session.threadId,
      ),
    },
  );
  const readError = await sessions()
    .read()
    .then(
      () => undefined,
      error => error as Error,
    );
  expect(readError?.message).toBe('Invalid recording review session.');
  expect(readError?.message).not.toContain(sourceId);
  expect(readError?.message).not.toContain(session.threadId);
  expect(await fixture.repository().list('health_observation')).toHaveLength(0);
});

test('a replaced descriptor refuses an otherwise valid committed receipt before returning success', async () => {
  const preview = await fixture.pending();
  const session = await sessions().begin();
  const pending = { ...preview, threadId: session.threadId };
  const approval = approvalFor(pending);
  await persistEncounterApproval(
    fixture.repository(),
    pending,
    approval,
    new AbortController().signal,
    true,
  );
  const records = await fixture.repository().list('health_observation');
  await sessions().begin();
  await expect(
    persistEncounterApproval(
      fixture.repository(),
      pending,
      approval,
      new AbortController().signal,
      true,
    ),
  ).rejects.toThrow('replaced');
  expect(await fixture.repository().list('health_observation')).toEqual(
    records,
  );
});

test('logical source removal erases discovery and fences a later descriptor recreation', async () => {
  await sessions().begin();
  await new SqlCipherAgentMemoryStorage(fixture.database()).markSourceRemoved(
    sourceId,
  );
  expect(await sessions().read()).toBeNull();
  await expect(sessions().begin()).rejects.toThrow('removed');
});
