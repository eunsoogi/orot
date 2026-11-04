import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { retainLiteratureResults } from '../researchLiteratureRetention';
import { localData } from '../featureServiceFixtures';

test('literature retry after a lost acknowledgement is idempotent without caching the abstract', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createResearchArtifactStorage(db.database);
    const append = storage.append.bind(storage);
    jest.spyOn(storage, 'append').mockImplementationOnce(async (...args) => {
      await append(...args);
      throw new Error('Synthetic lost acknowledgement');
    });
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => storage,
    });
    const search = jest.fn(async () => ({
      status: 'available' as const,
      publications: [
        {
          provider: 'Europe PMC' as const,
          source: 'MED',
          recordId: '123',
          title: 'Synthetic retry publication',
          authors: null,
          journal: null,
          publicationDate: null,
          updatedDate: null,
          abstract: 'Unsupported synthetic abstract',
          originalUrl: 'https://europepmc.org/article/MED/123',
          retrievedAt: '2026-10-05T00:00:00.000Z',
        },
      ],
    }));
    const service = retainLiteratureResults({ search }, async () => data);
    const options = { externalQueryConsented: true };
    await expect(service.search('public query', options)).rejects.toThrow(
      'lost acknowledgement',
    );
    const result = await service.search('public query', options);
    expect(
      result.status === 'available' && result.publications[0]?.abstract,
    ).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
    const saved = await storage.search('synthetic retry publication', null, 10);
    expect(saved.items).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toContain(
      'Unsupported synthetic abstract',
    );
  } finally {
    db.close();
  }
});
