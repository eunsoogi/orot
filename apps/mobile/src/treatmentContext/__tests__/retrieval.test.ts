import { createTreatmentPublicEvidenceTool } from '../retrieval';
import { referenceOnly } from '../../diseaseHypotheses/resultValidation';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { runMigrations } from '@orot/storage';

test('public literature receives only controlled topics and keeps separate query consent', async () => {
  const search = jest.fn().mockResolvedValue({ status: 'empty' });
  const authorize = jest.fn().mockResolvedValue('denied');
  const tool = createTreatmentPublicEvidenceTool({
    service: { search },
    consent: { authorize },
  });
  const request = {
    operationRunId: 'run',
    operationKey: 'call',
    input: { topics: ['sleep'] },
    allowedScope: { sourceKinds: ['external_medical' as const] },
    resultLimit: 3,
    maxPayloadBytes: 10000,
    signal: new AbortController().signal,
  };
  expect(await tool.search(request)).toEqual({ status: 'consent_required' });
  expect(search).not.toHaveBeenCalled();
  authorize.mockResolvedValue('authorized');
  await tool.search(request);
  expect(search).toHaveBeenCalledTimes(1);
  expect(search.mock.calls[0]![0]).toContain('sleep');
  await expect(
    tool.search({ ...request, input: { topics: ['private record text'] } }),
  ).rejects.toThrow();
  await expect(
    tool.search({ ...request, input: { topics: ['sleep'], name: 'private' } }),
  ).rejects.toThrow();
  expect(search).toHaveBeenCalledTimes(1);
});

test('observed publication access and limitations survive shared storage', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const tool = createTreatmentPublicEvidenceTool({
      consent: { authorize: async () => 'authorized' },
      service: {
        search: async () => ({
          status: 'available',
          publications: [
            {
              provider: 'Europe PMC',
              source: 'MED',
              recordId: '123',
              title: 'Synthetic paper',
              authors: null,
              journal: null,
              publicationDate: '2025-01-01',
              updatedDate: null,
              abstract: 'Synthetic abstract',
              originalUrl: 'https://europepmc.org/article/MED/123',
              retrievedAt: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      },
    });
    const batch = await tool.search({
      operationRunId: 'run',
      operationKey: 'call',
      input: { topics: ['sleep'] },
      allowedScope: { sourceKinds: ['external_medical'] },
      resultLimit: 3,
      maxPayloadBytes: 10000,
      signal: new AbortController().signal,
    });
    if ('status' in batch) throw new Error('Unexpected consent');
    const reference = referenceOnly(batch.items[0]!);
    const locator = reference.locator as {
      originalUrl: string;
      publicationDate: string;
      retrievedAt: string;
      sourceType: string;
      limitations: string[];
    };
    const publicEvidence = {
      reference,
      originalUrl: locator.originalUrl,
      publicationDate: locator.publicationDate,
      retrievedAt: locator.retrievedAt,
      sourceType: locator.sourceType,
      population: null,
      limitations: locator.limitations,
      availability: 'abstract' as const,
    };
    const treatmentContext = {
      version: 1 as const,
      conditions: [],
      clinicianPlans: { status: 'unavailable' as const },
      publicEvidence: [publicEvidence],
      missingContext: ['Population'],
      conflicts: [],
    };
    const store = createConversationArtifactStorage(db.database);
    await store.createSession('public', await store.currentGeneration());
    await store.append({
      id: 'turn',
      sessionId: 'public',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      question: 'question',
      answer: 'education',
      sources: [{ reference, records: [] }],
      treatmentContext,
    });
    expect((await store.read('turn'))?.treatmentContext).toEqual(
      treatmentContext,
    );
  } finally {
    db.close();
  }
});
