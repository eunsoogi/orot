import {
  calendarFixture,
  calendarTestObservation as observation,
  calendarTestRequest as request,
  calendarReportService,
} from '../testSupport/dailyReportCalendarTestFixture';
jest.mock('../../../calendar/calendarBridge', () => ({
  createCalendarBridge: jest.fn(),
}));
import { createCalendarBridge } from '../../../calendar/calendarBridge';
import { createManualHistoryRepository } from '@orot/storage';
import { validateDailyReportArtifact } from '../../../storage/dailyReportArtifactValidation';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { readDailyReportArtifact } from '../dailyReportArtifactDiscovery';
import { captureConversationSources } from '../captureConversationSources';
import type { AiFeatureLocalData } from '../localData';
import { DailyReportContextSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';

import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import {
  readReportCalendar,
  prepareReportCalendar,
  reportCalendarIsCurrent,
} from '../dailyReportSystemCalendar';

test('projects plans without titles or canceled activity, and disposes native state', async () => {
  const native = calendarFixture();
  const day = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00Z',
  });
  if (day.status !== 'ready') throw new Error('fixture');
  const prepared = await prepareReportCalendar(day.context, native.read);
  expect(prepared.facts).toHaveLength(1);
  expect(JSON.stringify(prepared.facts)).not.toContain('Private');
  expect(prepared.facts[0]?.text).toContain('미확정');
  expect(prepared.facts[0]?.text).toContain('실제 진료 여부는 확인되지');
  expect(
    await reportCalendarIsCurrent(
      { systemCalendar: prepared.binding },
      native.read,
    ),
  ).toBe(true);
  native.change();
  expect(await prepared.snapshot.revalidate()).toBe(false);
  expect(
    await reportCalendarIsCurrent(
      { systemCalendar: prepared.binding },
      native.read,
    ),
  ).toBe(false);
  prepared.snapshot.dispose();
  expect(native.listeners.size).toBe(0);
});

test('real SQLite retains separate calendar provenance and hides reopened prose after revoked access', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    jest
      .mocked(createCalendarBridge)
      .mockReturnValue(
        native.bridge as ReturnType<typeof createCalendarBridge>,
      );
    const { run, consent, generate } = calendarReportService(
      connection.database,
      native,
    );
    const result = await run(request());
    if (result.status !== 'completed') throw new Error(JSON.stringify(result));
    expect(result.context.systemCalendar).toBeDefined();
    expect(
      DailyReportContextSchema.safeParse({
        ...result.context,
        systemCalendar: undefined,
      }).success,
    ).toBe(false);
    expect(consent.mock.calls[0]?.[0].consentScope?.dataCategories).toContain(
      'calendar_plans',
    );
    expect(JSON.stringify(consent.mock.calls[0]?.[0].payload)).not.toContain(
      'Private',
    );
    expect(JSON.stringify(generate.mock.calls[0]?.[0])).not.toContain(
      'Private',
    );
    expect(
      result.report.supportedContext.some(item =>
        item.text.includes('진료·건강 관련 단어'),
      ),
    ).toBe(true);
    const raw = JSON.stringify(
      (
        await connection.database.execute(
          'SELECT result_json FROM symptom_summary_runs',
        )
      ).rows,
    );
    expect(raw).not.toContain('Private');
    const store = createDailyReportStorage(connection.database, native.read);
    expect((await store.lookup(result.context.identity)).status).toBe('saved');
    const nativeRead = await readReportCalendar(
      result.context.interval.fromInclusive,
      result.context.interval.toExclusive,
    );
    nativeRead.dispose();
    expect(await reportCalendarIsCurrent(result.context)).toBe(true);
    expect(
      (
        await createDailyReportStorage(connection.database).lookup(
          result.context.identity,
        )
      ).status,
    ).toBe('saved');
    const registry = new LocalEvidenceReferenceRegistry();
    const data = {
      repository: {
        readRecord: (kind: 'health_observation', id: string) =>
          createRecordRepository(connection.database).get(kind, id),
      },
      loadStaleArtifacts: async () => [],
      loadMemoryRecords: async () => [],
      manualHistory: createManualHistoryRepository(connection.database),
    } as unknown as AiFeatureLocalData;
    const artifact = await readDailyReportArtifact({
      database: connection.database,
      data,
      registry,
      id: result.runId,
    });
    expect(artifact?.sources.every(Boolean)).toBe(true);
    const citation = artifact?.sources.find(
      source => source.sourceKind === 'generated_artifact',
    );
    expect(citation).toBeDefined();
    const retained = await captureConversationSources(
      [citation!],
      registry,
      new AbortController().signal,
    );
    expect(retained.sources[0]).toMatchObject({
      kind: 'generated_summary',
      id: result.runId,
    });
    expect(
      await validateDailyReportArtifact(
        connection.database,
        result.runId,
        createManualHistoryRepository(connection.database),
      ),
    ).not.toBeNull();
    native.revoke();
    expect(
      await validateDailyReportArtifact(
        connection.database,
        result.runId,
        createManualHistoryRepository(connection.database),
      ),
    ).toBeNull();
    await expect(
      captureConversationSources(
        [citation!],
        registry,
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    expect((await store.lookup(result.context.identity)).status).toBe('stale');
    expect(await run(request())).toEqual({
      status: 'failed',
      code: 'source_stale',
    });
    expect(native.listeners.size).toBe(0);
  } finally {
    connection.close();
  }
});

test('calendar changes during exact consent prevent provider execution and persistence', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const native = calendarFixture();
  try {
    await runMigrations(connection.database);
    await createRecordRepository(connection.database).put(
      'health_observation',
      observation,
    );
    const { run, generate } = calendarReportService(
      connection.database,
      native,
      async () => {
        native.change();
        return 'authorized';
      },
    );
    expect(await run(request())).toEqual({
      status: 'failed',
      code: 'source_revision_changed',
    });
    expect(generate).not.toHaveBeenCalled();
    expect(
      (await connection.database.execute('SELECT id FROM symptom_summary_runs'))
        .rows,
    ).toHaveLength(0);
    expect(native.listeners.size).toBe(0);
  } finally {
    connection.close();
  }
});

test('title matching does not assert personal purpose and excludes English substrings', async () => {
  const native = calendarFixture();
  const list = native.bridge.listEventsInRange;
  native.bridge.listEventsInRange = async (from, to) => {
    const response = await list(from, to);
    return {
      ...response,
      events: response.events.map((event, index) => ({
        ...event,
        calendarStatus: 'confirmed' as const,
        calendarEventSnapshot: {
          ...event.calendarEventSnapshot,
          title:
            index === 0 ? 'hospitality conference' : '병원 데이터 계약회의',
        },
      })),
    };
  };
  const day = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00Z',
  });
  if (day.status !== 'ready') throw new Error('fixture');
  const prepared = await prepareReportCalendar(day.context, native.read);
  expect(prepared.facts).toHaveLength(1);
  expect(prepared.facts[0]?.text).toContain('제목 1건');
  expect(prepared.facts[0]?.text).toContain('개인 진료 계획으로 단정하지');
  expect(prepared.facts[0]?.modelText).toContain('unrelated work');
  prepared.snapshot.dispose();
});
