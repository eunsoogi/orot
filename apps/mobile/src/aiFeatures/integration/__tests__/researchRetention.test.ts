import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { localData } from '../featureServiceFixtures';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { createSelectedExternalEvidence } from '../selectedExternalEvidence';
import {
  retainLiteratureResults,
  retainPublicWebResults,
} from '../researchRetention';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

test('successful research searches retain separate public snapshots without publication abstract text', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => store,
    });
    const publication = {
      provider: 'Europe PMC' as const,
      source: 'MED',
      recordId: '123',
      title: 'Synthetic study',
      authors: null,
      journal: null,
      publicationDate: '2024-01-01',
      updatedDate: null,
      originalUrl: 'https://europepmc.org/article/MED/123',
      retrievedAt: '2026-10-05T00:00:00.000Z',
      abstract: 'Synthetic abstract that must not be saved',
    };
    const literature = retainLiteratureResults(
      {
        search: async () => ({
          status: 'available',
          publications: [publication],
        }),
      },
      async () => data,
    );
    await literature.search('public terms', { externalQueryConsented: true });
    const run = publicEvidenceFixture();
    const selected = createSelectedExternalEvidence({
      ...run,
      literature: { search: async () => ({ status: 'empty' }) },
      literatureConsent: { authorize: async () => 'authorized' },
      loadData: async () => data,
      originFeature: 'record_conversation',
    });
    const web = selected.tools.find(tool => tool.id === 'public-web-search');
    if (!web) throw new Error('Missing public web tool');
    await web.search({
      ...run.request,
      input: { topics: ['sleep'] },
    });
    const reopened = createResearchArtifactStorage(connection.database);
    const study = (await reopened.search('synthetic study', null, 10))
      .items[0]!;
    expect(study.source).toMatchObject({
      kind: 'publication',
      url: publication.originalUrl,
      status: 'historical_snapshot',
    });
    expect(JSON.stringify(study)).not.toContain(publication.abstract);
    const webResult = (await reopened.search('synthetic guideline', null, 10))
      .items[0]!;
    expect(webResult.source).toMatchObject({
      kind: 'public_web_search',
      sources: publicResponse.citations,
    });
    expect(webResult.generatedText).toContain(publicResponse.text);
    expect(JSON.stringify(webResult)).not.toContain('Public concept');
  } finally {
    connection.close();
  }
});

test('denied public search and a cancelled literature request retain nothing', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => store,
    });
    const run = publicEvidenceFixture();
    run.authorize.mockResolvedValue('renewal_required');
    const web = createPublicWebEvidence(run)!;
    expect(
      await retainPublicWebResults(
        web.tool,
        async () => data,
        'provider',
        'model',
        'record_conversation',
      ).search(run.request),
    ).toEqual({ status: 'consent_required' });
    const controller = new AbortController();
    const literature = retainLiteratureResults(
      {
        search: async () => {
          controller.abort();
          return { status: 'available', publications: [] };
        },
      },
      async () => data,
    );
    await expect(
      literature.search('terms', {
        externalQueryConsented: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect((await store.search('', null, 10)).items).toEqual([]);
  } finally {
    connection.close();
  }
});

test('free-form web results remain available but are not retained without their input lineage', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createResearchArtifactStorage(connection.database);
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => store,
    });
    const run = publicEvidenceFixture();
    const web = createPublicWebEvidence(run)!;
    const result = await retainPublicWebResults(
      { ...web.tool, search: () => web.tool.search(run.request) },
      async () => data,
      'provider',
      'model',
      'record_conversation',
    ).search({ ...run.request, input: { query: 'private free form' } });
    if ('status' in result) throw new Error('Unexpected consent');
    expect(result.items).toHaveLength(1);
    expect(result.coverage[0]?.gaps).toContain(
      'This free-form research result could not be retained without input lineage.',
    );
    expect((await store.search('', null, 10)).items).toEqual([]);
  } finally {
    connection.close();
  }
});
