import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import type { TreatmentExplanationRequest } from '../../../treatmentContext/interfaces';
import { produceTreatmentRequest } from '../../../treatmentContext/treatmentRequestProducer';
import { restoreConversationSessionPage } from '../conversationSessionRestoration';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('generic history withholds treatment turns while the treatment reopen path validates them', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const signal = new AbortController().signal;
    const request = {
      context: {
        version: 1,
        conditions: [],
        clinicianPlans: { status: 'unavailable' },
        publicEvidence: [],
        missingContext: [],
        conflicts: [],
      },
      sources: [],
      revalidateEvidence: async () => true,
    } as unknown as TreatmentExplanationRequest;
    expect(
      await produceTreatmentRequest(
        connection.database,
        { kind: 'request', selection: { kind: 'general_options' } },
        request,
        signal,
        [],
        {
          id: 'treatment',
          sessionId: 'session',
          createdAt: '2026-10-05T00:00:00.000Z',
          question: 'Synthetic treatment',
          expectedSessionVersion: 0,
        },
      ),
    ).toMatchObject({ status: 'validated' });
    await storage.append({
      id: 'ordinary',
      sessionId: 'session',
      createdAt: '2026-10-06T00:00:00.000Z',
      providerId: 'local',
      modelId: 'synthetic',
      status: 'complete',
      question: 'Hello',
      answer: 'Hello',
      sources: [],
      citations: [],
    });
    const page = await restoreConversationSessionPage({
      sessionId: 'session',
      storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data: localData([]).data,
      signal,
    });
    expect(page.items.map(item => item.id)).toEqual(['ordinary']);
    expect(page.unavailableCount).toBe(1);
    expect(
      await produceTreatmentRequest(
        connection.database,
        { kind: 'reopen', artifactId: 'treatment' },
        request,
        signal,
        [],
      ),
    ).toMatchObject({ status: 'validated' });
  } finally {
    connection.close();
  }
});
