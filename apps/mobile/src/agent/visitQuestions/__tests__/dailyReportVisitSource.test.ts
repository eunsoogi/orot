import {
  HealthObservationSchema,
  VisitQuestionCreateSchema,
} from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  mkdtempSync,
  rmSync,
  join,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { fingerprint } from '../../../aiFeatures/integration/evidenceUtils';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { validateDailyReportArtifact } from '../../../storage/dailyReportArtifactValidation';
import { generatedArtifactSource } from '../../../aiFeatures/integration/visitQuestionsRouteEvidence';
import { restoreSavedGeneratedSources } from '../../../aiFeatures/integration/savedVisitQuestionGeneratedSources';
import { createSummaryArtifactDiscovery } from '../../../aiFeatures/integration/summaryArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../../aiFeatures/integration/featureServiceFixtures';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { assertGeneratedVisitQuestionSource } from '../generatedVisitQuestionValidation';
import { citation } from '../../../aiFeatures/integration/testSupport/visitQuestionsRouteSaveFixtures';

test.each(['edit', 'delete'] as const)(
  'visit source rejects source %s after following the active daily report',
  async mutation => {
    const directory = mkdtempSync(join(tmpdir(), 'visit-daily-source-'));
    const db = openSqliteTestDatabase(join(directory, 'records.sqlite'));
    try {
      await runMigrations(db.database);
      const store = createDailyReportStorage(db.database);
      const repo = createRecordRepository(db.database);
      const record = HealthObservationSchema.parse({
        id: 'observation',
        effectiveAt: '2035-01-01T01:00:00Z',
        recordedAt: '2035-01-01T01:00:00Z',
        ingestedAt: '2035-01-01T01:00:00Z',
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept: 'heart_rate',
        value: { kind: 'quantity', amount: 72, unit: 'count/min' },
      });
      await repo.put('health_observation', record);
      const calendar = createDailyReportCalendarWindow({
        localDate: '2035-01-01',
        timeZone: 'UTC',
        requestedAt: '2035-01-01T12:00:00Z',
      });
      if (calendar.status !== 'ready') throw new Error('calendar');
      await store.lookup(calendar.context.identity);
      const revision = fingerprint(record);
      const context = createDailyReportContext(
        calendar.context,
        {
          revision: 'snapshot',
          ...(await readHealthContextGeneration(db.database)),
          records: [
            {
              source: 'manual',
              recordId: record.id,
              revision,
              occurrence: { startInclusive: record.effectiveAt! },
              ingestedAt: record.ingestedAt,
            },
          ],
          coverage: [],
        },
        { providerId: 'local', modelId: 'fixture' },
      );
      const report = {
        schemaVersion: 1 as const,
        identity: context.identity,
        generatedAt: '2035-01-01T12:01:00Z',
        observations: [
          {
            text: 'Synthetic',
            sourceReferences: [{ source: 'manual', recordId: record.id }],
          },
        ],
        supportedContext: [],
        coverage: [],
        followUpQuestions: [],
      };
      const input = {
        runId: 'report-1',
        context,
        result: { status: 'completed', report },
        lineage: [
          {
            source: 'manual',
            recordId: record.id,
            kind: 'health_observation' as const,
            localId: record.id,
            revision,
          },
        ],
        mode: { kind: 'initial' as const },
      };
      expect(await store.save(input)).toEqual({ status: 'saved' });
      const saved = await validateDailyReportArtifact(
        db.database,
        input.runId,
        repo.manualHistory,
      );
      expect(saved).not.toBeNull();
      const ref = citation({
        sourceKind: 'generated_artifact',
        sourceId: input.runId,
        evidenceId: input.runId,
        sourceRevision: saved!.fingerprint,
        evidenceRevision: saved!.fingerprint,
        locator: { kind: 'generated_artifact', type: 'daily_report' },
      });
      const source = generatedArtifactSource(ref);
      expect(source).toMatchObject({
        kind: 'generated_summary',
        type: 'daily_report',
      });
      const registry = new LocalEvidenceReferenceRegistry();
      const data = localData([]).data;
      jest
        .mocked(data.repository.readRecord)
        .mockImplementation(async () =>
          repo.get('health_observation', record.id),
        );
      Object.assign(data, {
        summaryArtifactDiscovery: async (r: LocalEvidenceReferenceRegistry) =>
          createSummaryArtifactDiscovery({
            database: db.database,
            storage: createSymptomSummaryStorage(db.database),
            data,
            registry: r,
          }),
      });
      const restored = await restoreSavedGeneratedSources(
        [source],
        data,
        registry,
      );
      expect(restored.items).toHaveLength(1);
      expect(
        await registry.revalidateEvidence(
          restored.items,
          new AbortController().signal,
        ),
      ).toBe(true);
      VisitQuestionCreateSchema.parse({
        id: 'q',
        questionText: '질문',
        rationale: '근거',
        priority: 'routine',
        position: 1,
        appointmentId: 'a',
        evidenceSpanIds: [],
        generatedArtifactSources: [source],
        effectiveAt: '2035-01-01T00:00:00Z',
        recordedAt: '2035-01-01T00:00:00Z',
        ingestedAt: '2035-01-01T00:00:00Z',
        provenance: { origin: 'derived', sourceRecordIds: ['a'] },
        reviewState: { status: 'unreviewed' },
      });
      const metadata = {
        sourceRecordIds: [],
        sourceRecordRevisions: [],
        sourceDates: [],
        generatedArtifactSource: source,
      };
      await expect(
        assertGeneratedVisitQuestionSource(
          ref,
          metadata,
          db.database,
          repo.manualHistory,
        ),
      ).resolves.toBeUndefined();
      expect(
        await store.save({
          ...input,
          runId: 'report-2',
          mode: { kind: 'revise', expectedRunId: 'report-1' },
        }),
      ).toEqual({ status: 'saved' });
      expect(
        await registry.revalidateEvidence(
          restored.items,
          new AbortController().signal,
        ),
      ).toBe(false);
      await expect(
        assertGeneratedVisitQuestionSource(
          ref,
          metadata,
          db.database,
          repo.manualHistory,
        ),
      ).rejects.toThrow();
      const next = await validateDailyReportArtifact(
        db.database,
        'report-2',
        repo.manualHistory,
      );
      const currentRef = {
        ...ref,
        sourceId: 'report-2',
        evidenceId: 'report-2',
        sourceRevision: next!.fingerprint,
        evidenceRevision: next!.fingerprint,
      };
      const currentMetadata = {
        ...metadata,
        generatedArtifactSource: generatedArtifactSource(currentRef),
      };
      await expect(
        assertGeneratedVisitQuestionSource(
          currentRef,
          currentMetadata,
          db.database,
          repo.manualHistory,
        ),
      ).resolves.toBeUndefined();
      if (mutation === 'edit')
        await repo.put('health_observation', {
          ...record,
          value: { kind: 'quantity', amount: 80, unit: 'count/min' },
        });
      else await repo.delete('health_observation', record.id);
      await expect(
        assertGeneratedVisitQuestionSource(
          currentRef,
          currentMetadata,
          db.database,
          repo.manualHistory,
        ),
      ).rejects.toThrow();
    } finally {
      await db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
