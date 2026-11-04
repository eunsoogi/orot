import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { localData } from '../featureServiceFixtures';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { retainPublicWebResults } from '../researchRetention';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('a failed research write is surfaced and a repeated search can save without duplicating the failed attempt', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const append = jest
      .spyOn(store, 'append')
      .mockRejectedValueOnce(new Error('Synthetic write failure'));
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => store,
    });
    const run = publicEvidenceFixture();
    const web = createPublicWebEvidence(run)!;
    const retained = retainPublicWebResults(
      web.tool,
      async () => data,
      'provider',
      'model',
      'symptom_summary',
    );
    const request = {
      ...run.request,
      input: { topics: ['sleep'] },
    };
    await expect(retained.search(request)).rejects.toThrow(
      'Synthetic write failure',
    );
    expect((await store.search('', null, 10)).items).toHaveLength(0);
    await retained.search(request);
    expect((await store.search('', null, 10)).items).toHaveLength(1);
    expect(append).toHaveBeenCalledTimes(2);
    expect(run.search).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});

test('retry after an uncertain commit reuses the saved snapshot without another provider call', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const realAppend = store.append.bind(store);
    jest.spyOn(store, 'append').mockImplementationOnce(async (...args) => {
      await realAppend(...args);
      throw new Error('Synthetic lost acknowledgement');
    });
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => store,
    });
    const run = publicEvidenceFixture();
    const web = createPublicWebEvidence(run)!;
    const retained = retainPublicWebResults(
      web.tool,
      async () => data,
      'provider',
      'model',
      'symptom_summary',
    );
    const request = {
      ...run.request,
      input: { topics: ['sleep'] },
    };
    await expect(retained.search(request)).rejects.toThrow(
      'Synthetic lost acknowledgement',
    );
    expect((await store.search('', null, 10)).items).toHaveLength(1);
    await retained.search(request);
    expect((await store.search('', null, 10)).items).toHaveLength(1);
    expect(run.search).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});

test('a deleted result cannot be restored by retrying a lost commit acknowledgement', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const realAppend = store.append.bind(store);
    jest.spyOn(store, 'append').mockImplementationOnce(async (...args) => {
      await realAppend(...args);
      throw new Error('Synthetic lost acknowledgement');
    });
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => store,
    });
    const run = publicEvidenceFixture();
    const retained = retainPublicWebResults(
      createPublicWebEvidence(run)!.tool,
      async () => data,
      'provider',
      'model',
      'symptom_summary',
    );
    const request = {
      ...run.request,
      input: { topics: ['sleep'] },
    };
    await expect(retained.search(request)).rejects.toThrow(
      'Synthetic lost acknowledgement',
    );
    await store.remove(1);
    await expect(retained.search(request)).rejects.toThrow('removed');
    expect((await store.search('', null, 10)).items).toEqual([]);
  } finally {
    connection.close();
  }
});
