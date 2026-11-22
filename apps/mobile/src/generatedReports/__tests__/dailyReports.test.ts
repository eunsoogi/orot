import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { parseDailyConversationReport } from '../../ragConversation/dailyConversationReportTemplate';
import { conversationDailyReportText } from '../../aiFeatures/integration/conversationDailyReportText';
import { t } from '../../i18n';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
import { createGeneratedReportReader } from '../readers';
const observation = HealthObservationSchema.parse({
  id: 'synthetic-observation',
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'heart_rate',
  value: { kind: 'quantity', amount: 72, unit: 'count/min' },
});
test('production daily save and revise preserves exact historical metadata, never substitutes active prose', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    const store = createDailyReportStorage(f.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('Invalid fixture');
    expect((await store.lookup(calendar.context.identity)).status).toBe(
      'missing',
    );
    const repository = createRecordRepository(f.database);
    await repository.put('health_observation', observation);
    const generation = await readHealthContextGeneration(f.database);
    const revision = fingerprint(observation);
    const coverage = [
      {
        source: 'calendar',
        status: 'partial' as const,
        limitationCodes: ['snapshot_incomplete'],
      },
    ];
    const context = createDailyReportContext(
      calendar.context,
      {
        revision: 'snapshot',
        ...generation,
        records: [
          {
            source: 'manual',
            recordId: observation.id,
            revision,
            occurrence: { startInclusive: observation.effectiveAt! },
            ingestedAt: observation.ingestedAt,
          },
        ],
        coverage,
      },
      { providerId: 'local', modelId: 'fixture' },
    );
    const report = {
      schemaVersion: 1 as const,
      identity: context.identity,
      generatedAt: '2035-01-01T12:01:00Z',
      observations: [
        {
          text: 'Synthetic private report',
          sourceReferences: [{ source: 'manual', recordId: observation.id }],
        },
      ],
      supportedContext: [],
      coverage,
      followUpQuestions: [],
    };
    const input = {
      runId: 'run-one',
      context,
      result: { status: 'completed', report },
      lineage: [
        {
          source: 'manual',
          recordId: observation.id,
          kind: 'health_observation' as const,
          localId: observation.id,
          revision,
        },
      ],
      mode: { kind: 'initial' as const },
    };

    expect(await store.save(input)).toEqual({ status: 'saved' });
    const reader = createGeneratedReportReader(f.database);
    const first = (await reader.list()).find(r => r.id === 'run-one')!;
    expect(first.kind).toBe('daily_report');
    const detail = await reader.read(first, new AbortController().signal);
    expect(detail?.paragraphs).toEqual([]);
    expect(detail?.dailyReport?.sections.map(section => section.title)).toEqual(
      [t('dailyReport.observations'), t('dailyReport.coverage.attention')],
    );
    expect(detail?.dailyReport?.sections[0]?.content).toBe(
      'Synthetic private report',
    );
    const saved = await store.lookup(context.identity);
    if (saved.status !== 'saved')
      throw new Error('Expected exact saved report');
    const chat = parseDailyConversationReport(
      conversationDailyReportText(saved),
    );
    expect(
      chat?.sections.map(({ title, content }) => ({
        title,
        content: content.trim(),
      })),
    ).toEqual(detail?.dailyReport?.sections);
    expect(detail?.conversationSources).toBeUndefined();
    expect(
      await store.save({
        ...input,
        runId: 'run-two',
        result: {
          status: 'completed',
          report: {
            ...report,
            observations: [
              { ...report.observations[0]!, text: 'Second version' },
            ],
          },
        },
        mode: { kind: 'revise', expectedRunId: 'run-one' },
      }),
    ).toEqual({ status: 'saved' });
    const rows = await reader.list();
    expect(rows.map(r => r.id)).toEqual(['run-two', 'run-one']);
    expect(rows.find(r => r.id === 'run-one')?.unavailable).toBe(true);
    expect(await reader.read(first, new AbortController().signal)).toBeNull();
    expect(
      (await reader.read(rows[0]!, new AbortController().signal))?.dailyReport
        ?.sections[0]?.content,
    ).toContain('Second version');
    const otherCalendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'Asia/Seoul',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (otherCalendar.status !== 'ready') throw new Error('Invalid fixture');
    const otherContext = createDailyReportContext(
      otherCalendar.context,
      { ...context.sourceSnapshot, coverage: [] },
      context.provider,
    );
    expect(
      await store.save({
        ...input,
        runId: 'other-identity',
        context: otherContext,
        result: {
          status: 'completed',
          report: {
            ...report,
            identity: otherContext.identity,
            observations: [],
            supportedContext: report.observations,
            coverage: [],
          },
        },
      }),
    ).toEqual({ status: 'saved' });
    const other = (await reader.list()).find(r => r.id === 'other-identity')!;
    const legacy = await reader.read(other, new AbortController().signal);
    expect(legacy?.dailyReport?.sections).toEqual([
      {
        title: t('dailyReport.supportedContext'),
        content: 'Synthetic private report',
      },
    ]);
    expect(legacy?.conversationSources).toBeUndefined();
    await repository.delete('health_observation', observation.id);
    expect(
      await reader.read(rows[0]!, new AbortController().signal),
    ).toBeNull();
  } finally {
    f.close();
  }
});
