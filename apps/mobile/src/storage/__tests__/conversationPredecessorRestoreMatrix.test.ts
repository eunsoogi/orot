import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import {
  healthContextFixture,
  window,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

// Real SQLite connection close/reopen proves retained identity, not an OS restart or
// provider non-replay. Stop is interrupted/user-stopped, distinct from cancelled.
const cases = [
  ['same', 'stopped'],
  ['different', 'stopped'],
  ['same', 'successful'],
  ['different', 'successful'],
] as const;

test.each(cases)(
  '%s question after %s predecessor retains exact completion identities on reopen',
  async (wording, predecessor) => {
    const directory = mkdtempSync(join(tmpdir(), 'conversation-predecessors-'));
    const path = join(directory, 'records.sqlite');
    let closeConnection: (() => void) | undefined;
    try {
      const f = await healthContextFixture(undefined, path);
      closeConnection = f.close;
      const cutoff = '2026-10-05T00:00:00.000Z';
      const scope = {
        kind: 'health_context_period' as const,
        version: 1 as const,
        topic: 'measurements' as const,
        window: { ...window, dataAvailableThrough: cutoff },
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
      const prior = {
        id: 'prior',
        sessionId: 'session',
        sessionVersion: 0,
        question: 'Synthetic prior question',
        createdAt: '2026-10-05T01:00:00.000Z',
      };
      const latest = {
        ...prior,
        id: 'latest',
        question:
          wording === 'same' ? prior.question : 'Synthetic different question',
        createdAt: '2026-10-05T02:00:00.000Z',
      };
      const retained = {
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete' as const,
        sources: [source],
        citations: [source.reference],
      };
      await storage.startRequest(prior);
      if (predecessor === 'stopped')
        await storage.interruptRequest(
          prior.id,
          prior.sessionId,
          0,
          'interrupted',
          'user-stopped',
        );
      else
        await storage.append({ ...prior, ...retained, answer: 'Prior answer' });
      await storage.startRequest(latest);
      await storage.append({ ...latest, ...retained, answer: 'Latest answer' });
      const identities = await storage.listCompletionIdentities();
      expect(identities.map(item => item.requestId).sort()).toEqual(
        predecessor === 'successful' ? ['latest', 'prior'] : ['latest'],
      );
      // This later import has an earlier clinical time but cannot contribute
      // to either immutable ingestion-cutoff snapshot.
      await f.repository.put('health_observation', {
        ...f.inside,
        id: 'late-import',
        ingestedAt: '2026-10-06T00:00:00.000Z',
      });
      f.close();
      closeConnection = undefined;
      const connection = createHealthEvidenceTestDatabase(path);
      closeConnection = connection.close;
      await connection.database.execute('PRAGMA foreign_keys = ON');
      const reopened = createConversationArtifactStorage(connection.database);
      await reopened.interruptRecoveredRequests();
      expect(await reopened.listCompletionIdentities()).toEqual(identities);
      expect(await reopened.read('latest')).toMatchObject({
        id: 'latest',
        question: latest.question,
        answer: 'Latest answer',
      });
      if (predecessor === 'successful')
        expect(await reopened.read('prior')).toMatchObject({
          id: 'prior',
          question: prior.question,
          answer: 'Prior answer',
        });
      else expect(await reopened.read('prior')).toBeNull();
      expect(await reopened.listInterruptedRequests('session', 0)).toEqual(
        predecessor === 'stopped'
          ? [
              expect.objectContaining({
                id: 'prior',
                question: prior.question,
                interruptionReason: 'user-stopped',
              }),
            ]
          : [],
      );
      expect(
        (await reopened.listTimeline('session', 0)).items.map(item => item.id),
      ).toEqual(['latest', 'prior']);
      expect(
        (
          await connection.database.execute(
            'SELECT id, question, status FROM conversation_requests ORDER BY id',
          )
        ).rows,
      ).toEqual([
        { id: 'latest', question: latest.question, status: 'completed' },
        {
          id: 'prior',
          question: prior.question,
          status: predecessor === 'successful' ? 'completed' : 'interrupted',
        },
      ]);
    } finally {
      closeConnection?.();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
