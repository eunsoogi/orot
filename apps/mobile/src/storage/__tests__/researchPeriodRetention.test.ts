import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createResearchArtifactStorage } from '../researchArtifactStorage';

test('research derived from a health period survives unrelated changes and is removed with a contributor', async () => {
  const f = await healthContextFixture();
  try {
    await f.storage.list();
    const research = createResearchArtifactStorage(f.database);
    const generation = await research.currentGeneration();
    await research.append(
      [
        {
          createdAt: '2026-10-05T00:00:00.000Z',
          originFeature: 'symptom_summary',
          providerId: 'provider',
          modelId: 'model',
          source: {
            kind: 'public_web_search',
            status: 'historical_snapshot',
            retrievedAt: '2026-10-05T00:00:00.000Z',
            sources: [{ title: 'Synthetic', url: 'https://example.org' }],
          },
          generatedText: 'A generated result',
          inputSources: f.saved.sources,
        },
      ],
      generation,
    );
    await f.repository.put(
      'health_observation',
      healthObservation('outside', 'heart_rate', '2026-09-30T01:00:00Z'),
    );
    expect(await research.read(1)).not.toBeNull();
    await f.repository.delete('health_observation', f.inside.id);
    expect(await research.read(1)).toBeNull();
    expect(
      (await f.database.execute('SELECT id FROM research_artifacts')).rows,
    ).toHaveLength(0);
    await expect(
      research.append(
        [
          {
            createdAt: '2026-10-05T00:00:00.000Z',
            originFeature: 'symptom_summary',
            providerId: 'provider',
            modelId: 'model',
            source: {
              kind: 'public_web_search',
              status: 'historical_snapshot',
              retrievedAt: '2026-10-05T00:00:00.000Z',
              sources: [{ title: 'Synthetic', url: 'https://example.org' }],
            },
            generatedText: 'Late result',
            inputSources: f.saved.sources,
          },
        ],
        generation,
      ),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
