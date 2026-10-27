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
