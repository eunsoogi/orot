import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import { providerSuccess } from '@orot/model-runtime';
import type { EvidenceSearchTool } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createResearchArtifactStorage } from '../../../storage/researchArtifactStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildManualHistoryEvidence } from '../manualHistoryEvidence';
import { createResearchInputTracker } from '../researchInputTracker';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { retainPublicWebResults } from '../researchRetention';
import { localData } from '../featureServiceFixtures';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

test('a source deleted during a free-form web request cannot be saved in its result', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const history = createManualHistoryRepository(db.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Private synthetic source',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    if (!evidence) throw new Error('Missing fixture');
    const registry = new LocalEvidenceReferenceRegistry();
    const item = buildManualHistoryEvidence({
      candidates: [evidence],
      repository: history,
      registry,
    }).items[0]!;
    const local: EvidenceSearchTool = {
      id: 'fixture',
      sourceKind: 'personal_record',
      execution: 'local_read_only',
      description: 'fixture',
      inputSchema: {},
      parseInput: () => ({}),
      search: async () => ({ items: [item], coverage: [], conflicts: [] }),
    };
    const tracker = createResearchInputTracker(registry);
    const run = publicEvidenceFixture();
    await tracker.wrap([local])[0]!.search({
      ...run.request,
      allowedScope: { sourceKinds: ['personal_record'] },
    });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    run.search.mockImplementation(async () => {
      entered();
      await gate;
      return providerSuccess(publicResponse);
    });
    const storage = createResearchArtifactStorage(db.database);
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => storage,
    });
    const web = createPublicWebEvidence(run)!;
    const pending = retainPublicWebResults(
      web.tool,
      async () => data,
      'provider',
      'model',
      'symptom_summary',
      undefined,
      tracker.capture,
    ).search(run.request);
    await started;
    await history.delete(entry.id);
    release();
    await expect(pending).rejects.toThrow();
    expect(
      (await db.database.execute('SELECT id FROM research_artifacts')).rows,
    ).toHaveLength(0);
  } finally {
    db.close();
  }
});

test('a source removed during query consent prevents dispatch to the public provider', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const history = createManualHistoryRepository(db.database);
    const entry = await history.create({
      kind: 'note',
      title: 'Synthetic',
      details: 'Private synthetic source',
      effectiveDate: { status: 'unknown' },
    });
    const evidence = await history.getEvidence(entry.id);
    if (!evidence) throw new Error('Missing fixture');
    const registry = new LocalEvidenceReferenceRegistry();
    const item = buildManualHistoryEvidence({
      candidates: [evidence],
      repository: history,
      registry,
    }).items[0]!;
    const local: EvidenceSearchTool = {
      id: 'fixture',
      sourceKind: 'personal_record',
      execution: 'local_read_only',
      description: 'fixture',
      inputSchema: {},
      parseInput: () => ({}),
      search: async () => ({ items: [item], coverage: [], conflicts: [] }),
    };
    const tracker = createResearchInputTracker(registry);
    const run = publicEvidenceFixture();
    await tracker.wrap([local])[0]!.search({
      ...run.request,
      allowedScope: { sourceKinds: ['personal_record'] },
    });
    run.authorize.mockImplementation(async () => {
      await history.delete(entry.id);
      return 'authorized';
    });
    const storage = createResearchArtifactStorage(db.database);
    const data = Object.assign(localData([]).data, {
      openResearchArtifactStorage: async () => storage,
    });
    const web = createPublicWebEvidence({
      ...run,
      beforeDispatch: (_query, signal) => tracker.revalidate(signal),
    })!;
    const retained = retainPublicWebResults(
      web.tool,
      async () => data,
      'provider',
      'model',
      'symptom_summary',
      undefined,
      tracker.capture,
    );
    await expect(retained.search(run.request)).rejects.toThrow(
      'changed before public search',
    );
    expect(run.search).not.toHaveBeenCalled();
    expect((await storage.search('', null, 10)).items).toEqual([]);
  } finally {
    db.close();
  }
});
