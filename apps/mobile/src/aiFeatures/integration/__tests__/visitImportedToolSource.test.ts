import { HealthObservationSchema } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { mapRagHitToVisitQuestionEvidence } from '../../../agent/visitQuestions/evidence';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createVisitQuestionSourceService } from '../visitQuestionSourceRegistration';
import { createConversationVisitToolSource } from '../conversationVisitToolSource';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { localData } from '../featureServiceFixtures';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { appointment } from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { readImportedVisitSource } from '../visitImportedSourceReader';

// Synthetic imported observation; exercise the real SQLite reader and visit mapping.
test.each([
  'unchanged',
  'deleted',
  'changed',
  'manual',
  'wrong_source',
  'wrong_revision',
  'wrong_locator',
  'denied',
  'wrong_source_revision',
  'other_import',
  'collision',
  'abort',
])(
  'imported visit tool source retains only exact current evidence: %s',
  async state => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const records = createRecordRepository(connection.database);
      const observation = HealthObservationSchema.parse({
        id: 'synthetic-observation',
        effectiveAt: '2026-10-18T00:00:00Z',
        ingestedAt: '2026-10-18T00:01:00Z',
        provenance: {
          origin: 'imported',
          sourceRecordIds: ['synthetic-sample'],
          source: { system: 'healthkit' },
        },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 72, unit: 'count/min' },
      });
      await records.put('health_observation', observation);
      const mapped = await mapRagHitToVisitQuestionEvidence(records, {
        chunk: chunkStructuredRecord('health_observation', observation),
        score: 1,
        lexicalRank: 1,
        vectorRank: 1,
      });
      if (state === 'deleted')
        await records.delete('health_observation', observation.id);
      if (state === 'changed')
        await records.put('health_observation', {
          ...observation,
          value: { kind: 'quantity', amount: 90, unit: 'count/min' },
        });
      if (state === 'manual')
        await records.put('health_observation', {
          ...observation,
          recordedAt: observation.effectiveAt,
          provenance: { ...observation.provenance, origin: 'user_reported' },
        } as never);
      if (state === 'other_import')
        await records.put('health_observation', {
          ...observation,
          provenance: {
            ...observation.provenance,
            source: { system: 'other' },
          },
        });
      if (state === 'collision')
        await records.put('appointment', {
          ...appointment,
          id: observation.id,
        });
      const reference = {
        ...mapped.item,
        ...(state === 'wrong_source' ? { sourceId: 'unrelated-sample' } : {}),
        ...(state === 'wrong_revision'
          ? { evidenceRevision: 'unrelated-revision' }
          : {}),
        ...(state === 'wrong_source_revision'
          ? { sourceRevision: 'unrelated-source-revision' }
          : {}),
        ...(state === 'wrong_locator'
          ? {
              locator: {
                kind: 'structured_record',
                recordId: 'unrelated-record',
              },
            }
          : {}),
      };
      const registry = new LocalEvidenceReferenceRegistry();
      if (state === 'abort') {
        const controller = new AbortController();
        controller.abort();
        const repository = createLocalHealthEvidenceRepository(
          connection.database,
        );
        const read = jest.spyOn(repository, 'readRecord');
        await expect(
          readImportedVisitSource(repository, reference, controller.signal),
        ).resolves.toEqual({ status: 'unavailable' });
        expect(read).not.toHaveBeenCalled();
        return;
      }
      const service = createVisitQuestionSourceService(registry, async () => ({
        ...localData([]).data,
        repository: createLocalHealthEvidenceRepository(connection.database),
      }));
      const source = createConversationVisitToolSource(
        registry,
        service.registerVisitQuestionSource,
      )(reference, async () => state !== 'denied');
      const capture = captureConversationToolSources(
        {
          version: 1,
          operationRunId: 'run',
          callId: 'call',
          toolName: 'search',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind: 'personal_record' },
          sources: [source],
        },
        registry,
      );
      if (state !== 'unchanged') {
        await expect(capture).rejects.toThrow();
        return;
      }
      const captured = await capture;
      expect(captured.dependencies).toHaveLength(1);
      expect(captured.dependencies[0]).toMatchObject({
        records: [{ kind: 'health_observation', id: observation.id }],
      });
      const storage = createConversationArtifactStorage(connection.database);
      await storage.createSession('session', await storage.currentGeneration());
      await storage.appendToolEvent({
        sessionId: 'session',
        messageId: 'turn',
        sessionVersion: 0,
        createdAt: new Date(observation.ingestedAt).toISOString(),
        ...captured,
      });
      expect(await storage.readToolTurns('session', 0)).toHaveLength(1);
      await records.delete('health_observation', observation.id);
      expect(await storage.readToolTurns('session', 0)).toEqual([]);
    } finally {
      connection.close();
    }
  },
);
