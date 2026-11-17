import {
  healthContextFixture,
  window,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';

const cutoff = '2026-10-05T00:00:00.000Z';
/** Synthetic snapshot with an earlier stopped request and a new same-question completion. */
async function setup(bounded = true) {
  const f = await healthContextFixture();
  const scope = {
    kind: 'health_context_period' as const,
    version: 1 as const,
    topic: 'measurements' as const,
    window: { ...window, ...(bounded ? { dataAvailableThrough: cutoff } : {}) },
  };
  const report = await f.read(scope.window, [scope.topic]);
  const revision = healthContextRevision(scope, report);
  const original = f.saved.sources[0]!;
  const source = {
    ...original,
    kind: 'health_context_period' as const,
    scope,
    revision,
    deletionGeneration: report.deletionGeneration,
    reference: {
      ...original.reference,
      locator: scope,
      sourceRevision: revision,
      evidenceRevision: revision,
    },
  };
  const storage = createConversationArtifactStorage(f.database);
  await storage.createSession('session', await storage.currentGeneration());
  const request = {
    id: 'completed',
    sessionId: 'session',
    sessionVersion: 0,
    question: 'Synthetic repeated report',
    createdAt: cutoff,
  };
  await storage.startRequest({
    ...request,
    id: 'stopped',
    createdAt: '2026-10-04T00:00:00.000Z',
  });
  await storage.interruptRequest(
    'stopped',
    'session',
    0,
    'interrupted',
    'user-stopped',
  );
  await storage.startRequest(request);
  await storage.append({
    ...request,
    providerId: 'synthetic',
    modelId: 'synthetic',
    status: 'complete',
    answer: 'Synthetic saved answer',
    sources: [source],
    citations: [source.reference],
  });
  return { ...f, storage, scope, revision };
}

// A historical answer's ingestion cutoff excludes later imports even when their clinical time is older.
test.each([
  '2026-10-06T00:00:00.000Z',
  '2026-10-05T00:00:00.0000001Z',
  '2026-10-05T09:00:00.0000001+09:00',
])(
  'late import %s preserves the completed snapshot and checkpoint across adapter reopen',
  async ingestedAt => {
    const f = await setup();
    try {
      expect(await f.storage.read('completed')).not.toBeNull();
      await f.repository.put('health_observation', {
        ...f.inside,
        id: 'later-import',
        ingestedAt,
      });
      expect(
        healthContextRevision(
          f.scope,
          await f.read(f.scope.window, [f.scope.topic]),
        ),
      ).toBe(f.revision);
      const reopened = createConversationArtifactStorage(f.database);
      await reopened.interruptRecoveredRequests();
      expect(await reopened.read('completed')).not.toBeNull();
      expect(await reopened.listCompletionIdentities()).toHaveLength(1);
      expect(
        (await reopened.listInterruptedRequests('session', 0)).map(
          item => item.id,
        ),
      ).toEqual(['stopped']);
      expect(
        (await reopened.listTimeline('session', 0)).items.map(item => item.id),
      ).toEqual(['completed', 'stopped']);
    } finally {
      f.close();
    }
  },
);

test.each([
  cutoff,
  '2026-10-05T09:00:00.000+09:00',
  '2026-10-04T23:59:59.9999999Z',
])(
  'an import at or before the snapshot cutoff still invalidates its answer (%s)',
  async ingestedAt => {
    const f = await setup();
    try {
      await f.repository.put('health_observation', {
        ...f.inside,
        id: 'new-contributor',
        ingestedAt,
      });
      expect(await f.storage.read('completed')).toBeNull();
      expect(await f.storage.listCompletionIdentities()).toEqual([]);
    } finally {
      f.close();
    }
  },
);

test('an unbounded legacy period remains sensitive to later imports', async () => {
  const f = await setup(false);
  try {
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'new-contributor',
      ingestedAt: '2026-10-06T00:00:00.000Z',
    });
    expect(await f.storage.read('completed')).toBeNull();
  } finally {
    f.close();
  }
});

test.each(['update', 'delete', 'stale'] as const)(
  'snapshot cutoff does not weaken an existing contributor %s fence',
  async operation => {
    const f = await setup();
    try {
      if (operation === 'update')
        await f.repository.put('health_observation', {
          ...f.inside,
          ingestedAt: '2026-10-06T00:00:00.000Z',
          value: { kind: 'quantity', amount: 12, unit: 'count/min' },
        });
      else if (operation === 'delete')
        await f.database.execute(
          'DELETE FROM health_observations WHERE id = ?',
          [f.inside.id],
        );
      else
        await f.database.execute(
          'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [
            'synthetic',
            'health_observation',
            f.inside.id,
            'old',
            'new',
            cutoff,
          ],
        );
      expect(await f.storage.read('completed')).toBeNull();
    } finally {
      f.close();
    }
  },
);

test('reopening upgrades the old insert trigger without losing saved answers', async () => {
  const f = await setup();
  try {
    await f.database.execute(
      'DROP TRIGGER conversation_period_added_health_observations',
    );
    await f.database
      .execute(`CREATE TRIGGER conversation_period_added_health_observations
      AFTER INSERT ON health_observations BEGIN
      DELETE FROM conversation_artifacts WHERE id IN
        (SELECT artifact_id FROM conversation_artifact_periods WHERE topic = 'measurements'); END`);
    const reopened = createConversationArtifactStorage(f.database);
    await reopened.listCompletionIdentities();
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'new-import-after-upgrade',
      ingestedAt: '2026-10-06T00:00:00.000Z',
    });
    expect(await reopened.read('completed')).not.toBeNull();
    expect(await reopened.listCompletionIdentities()).toHaveLength(1);
  } finally {
    f.close();
  }
});
