import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';
import { captureConversationToolSources } from '../../aiFeatures/integration/captureConversationToolSources';
import { captureConversationSources } from '../../aiFeatures/integration/captureConversationSources';
import { presentEvidenceSource } from '../../aiFeatures/integration/evidenceSourcePresentation';
import { createConversationSessionOptions } from '../../aiFeatures/integration/conversationSessionOptions';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test.each([
  ['sYnThEtIc A', 0, 'dose-1'],
  ['sYnThEtIc A', 2, 'dose-1'],
  ['PRIVATE_UNMATCHED', 0, 'dose-1'],
  ['sYnThEtIc A', 0, 'sYnThEtIc A'],
] as const)(
  'reopens filtered tool sources without persisting input %s, page %i',
  async (filter, page, doseId) => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-filtered-tool-'));
    const path = join(directory, 'records.sqlite');
    let connection = openSqliteTestDatabase(path);
    try {
      await runMigrations(connection.database);
      const repository = createRecordRepository(connection.database);
      await repository.put('medication_definition', {
        ...medicationDefinition('medication-1', '2026-09-01T00:00:00Z'),
        displayText: 'Synthetic A',
      });
      await repository.put(
        'dose_event',
        importedDoseEvent(doseId, '2026-10-01T01:00:00Z', 'taken'),
      );
      await repository.put('dose_event', {
        ...importedDoseEvent('dose-2', '2026-10-02T01:00:00Z', 'skipped'),
        ingestedAt: '2026-10-03T00:00:00Z',
      });
      let storage = createConversationArtifactStorage(connection.database);
      await storage.createSession('session', await storage.currentGeneration());
      const read = createHealthContextReader(connection.database);
      const window = {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-03T00:00:00Z',
        timeZone: 'UTC',
        doseHistory: { medicationName: filter, page, pageSize: 1 },
      };
      const scope = {
        kind: 'health_context_period' as const,
        version: 1 as const,
        topic: 'medications' as const,
        window,
      };
      const report = await read(window, ['medications']);
      const registry = new LocalEvidenceReferenceRegistry();
      const item = registerHealthContextEvidence({
        registry,
        read,
        scope,
        report,
      });
      const {
        sourceKind,
        sourceId,
        sourceRevision,
        evidenceId,
        evidenceRevision,
      } = item;
      const captured = await captureConversationToolSources(
        {
          version: 1,
          operationRunId: 'run',
          callId: 'call',
          toolName: 'health',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind },
          sources: [
            {
              sourceKind,
              sourceId,
              sourceRevision,
              evidenceId,
              evidenceRevision,
            },
          ],
        },
        registry,
        storage,
      );
      const dependency = captured.dependencies[0]!;
      await storage.appendToolEvent({
        sessionId: 'session',
        messageId: 'turn',
        createdAt: '2026-11-06T00:00:00.000Z',
        sessionVersion: 0,
        ...captured,
        dependencies: [
          {
            ...dependency,
            extra: 'SECRET_OUTPUT',
            reference: { ...dependency.reference, extra: 'SECRET_REASONING' },
          } as unknown as typeof dependency,
        ],
      });
      const rows = await connection.database.execute(
        'SELECT event_json, sources_json FROM conversation_tool_events JOIN conversation_tool_lineage USING (session_id, run_id, call_id)',
      );
      expect(JSON.stringify(rows)).not.toContain(filter);
      expect(JSON.stringify(rows)).not.toContain('Synthetic A');
      expect(JSON.stringify(rows)).not.toMatch(/SECRET_/);
      connection.close();
      connection = openSqliteTestDatabase(path);
      storage = createConversationArtifactStorage(connection.database);
      const fresh = new LocalEvidenceReferenceRegistry();
      const data = {
        ...localData([]).data,
        readHealthContext: createHealthContextReader(connection.database),
      };
      const options = createConversationSessionOptions({
        registry: fresh,
        loadLocalData: async () => ({
          ...data,
          openConversationArtifactStorage: async () => storage,
          conversationArtifactDiscovery: async () =>
            createConversationArtifactDiscovery({
              database: connection.database,
              storage,
              data,
              registry: fresh,
            }),
        }),
      });
      const [turn] = await options.restoreSession!(
        'session',
        new AbortController().signal,
      );
      const alias = fresh.resolveToolReference(
        turn!.toolEvents![0]!.sources[0]!,
      )!;
      const result = await fresh.readSource(
        alias,
        new AbortController().signal,
      );
      expect(result.status).toBe('available');
      if (
        result.status !== 'available' ||
        result.document.sourceKind !== 'health_context_period'
      )
        throw new Error('Expected period source.');
      expect(result.document.filterRedacted).toBe(true);
      expect(JSON.stringify(presentEvidenceSource(result.document))).toContain(
        '검색 조건',
      );
      expect(result.document.report.doseHistory).toEqual(report.doseHistory);
      expect(JSON.stringify(result.document.scope)).not.toContain(filter);
      await expect(
        captureConversationSources(
          [alias],
          fresh,
          new AbortController().signal,
        ),
      ).rejects.toThrow('cannot be retained as a new citation');
      await createRecordRepository(connection.database).delete(
        'dose_event',
        doseId,
      );
      expect(
        (await fresh.readSource(alias, new AbortController().signal)).status,
      ).toBe('unavailable');
      expect(await storage.readToolTurns('session')).toEqual([]);
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
