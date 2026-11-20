import { HealthObservationSchema } from '@orot/domain';
import {
  createRecordRepository,
  createManualHistoryRepository,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../../healthEvidence/healthContext/generation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createDailyReportSourceResolver } from '../dailyReportSources';
import { dailyReportSensorFacts } from '../dailyReportSensorFacts';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';

test('groups only proven retained observations and preserves every backing revision', async () => {
  const db = openSqliteTestDatabase(':memory:');
  const signal = new AbortController().signal;
  try {
    await runMigrations(db.database);
    const store = createDailyReportStorage(db.database);
    const day = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (day.status !== 'ready') throw new Error('Invalid day');
    await store.lookup(day.context.identity);
    const repository = createRecordRepository(db.database);
    const values = [];
    const records = [];
    for (let index = 0; index < 124; index++) {
      const time = new Date(
        Date.parse('2035-01-01T01:00:00Z') + index * 1000,
      ).toISOString();
      const record = HealthObservationSchema.parse({
        id: `synthetic-${index}`,
        effectiveAt: time,
        recordedAt: time,
        ingestedAt: time,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept:
          index < 120
            ? 'heart_rate'
            : index < 122
              ? 'respiratory_rate'
              : 'unclassified_sensor',
        value: { kind: 'quantity', amount: 60 + index, unit: 'count/min' },
      });
      await repository.put('health_observation', record);
      values.push({ kind: 'health_observation', record });
      records.push({
        source: 'health_observation',
        recordId: record.id,
        revision: fingerprint(record),
        occurrence: { startInclusive: time },
        ingestedAt: time,
      });
    }
    const context = createDailyReportContext(
      day.context,
      {
        revision: 'synthetic-snapshot',
        ...(await readHealthContextGeneration(db.database)),
        records,
        coverage: [],
      },
      { providerId: 'local', modelId: 'fixture' },
    );
    const facts = dailyReportSensorFacts(values, records).facts;
    const observations = facts.map(({ text, sourceReferences }) => ({
      text,
      sourceReferences,
    }));
    // Similar text and overlapping members cannot attest a third statistic.
    observations[2].text = 'Legacy observation with no canonical statistic';
    const supportedContext = [
      {
        text: 'Different inference; same exact evidence set',
        sourceReferences: observations[0].sourceReferences,
      },
      {
        text: 'Individual observation explicitly cited',
        sourceReferences: [observations[0].sourceReferences[0]],
      },
    ];
    const saved = await store.save({
      runId: 'report',
      context,
      result: {
        status: 'completed',
        report: {
          schemaVersion: 1,
          identity: context.identity,
          generatedAt: '2035-01-01T12:01:00Z',
          observations: [...observations, observations[0]],
          supportedContext,
          coverage: [],
          followUpQuestions: [],
        },
      },
      lineage: records.map(record => ({
        ...record,
        kind: 'health_observation',
        localId: record.recordId,
      })),
      mode: { kind: 'initial' },
    });
    expect(saved.status).toBe('saved');
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      repository: { readRecord: (kind, id) => repository.get(kind, id) },
      loadStaleArtifacts: async () => [],
      loadMemoryRecords: async () => [],
      manualHistory: createManualHistoryRepository(db.database),
    };
    const discovery = createSummaryArtifactDiscovery({
      database: db.database,
      storage: createSymptomSummaryStorage(db.database),
      data,
      registry,
    });
    data.summaryArtifactDiscovery = async () => discovery;
    const resolve = createDailyReportSourceResolver({
      data: async () => data,
      registry,
      report: store,
    });
    const calls = [];
    const read = registry.readSource.bind(registry);
    registry.readSource = (...args) => {
      calls.push(args[0]);
      return read(...args);
    };
    const flat = await resolve(context.identity, 'report', 1, signal);
    expect(flat.status).toBe('current');
    expect(flat.sources).toHaveLength(124);
    expect(flat.presentation).toBeUndefined();
    expect(calls).toHaveLength(0);
    const grouped = await resolve(
      context.identity,
      'report',
      1,
      signal,
      'presentation',
    );
    expect(grouped.status).toBe('current');
    expect(grouped.sources).toHaveLength(124);
    expect(
      grouped.presentation.statistics.map(members => members.length),
    ).toEqual([120, 2]);
    expect(grouped.presentation.directSources).toEqual([0]);
    expect(grouped.presentation.otherSources).toEqual([122, 123]);
    expect(calls).toHaveLength(124);
    // A late member deletion must beat the cached display proof and final return.
    let shouldDelete = true;
    registry.readSource = async (...args) => {
      if (shouldDelete) {
        shouldDelete = false;
        await repository.delete('health_observation', 'synthetic-57');
      }
      return read(...args);
    };
    expect(
      await resolve(context.identity, 'report', 1, signal, 'presentation'),
    ).toEqual({ status: 'deleted' });
  } finally {
    db.close();
  }
});
