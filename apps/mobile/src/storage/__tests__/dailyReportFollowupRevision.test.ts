import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { readHealthContextGeneration } from '../../healthEvidence/healthContext/generation';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationSessionOptions } from '../../aiFeatures/integration/conversationSessionOptions';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createDailyReportStorage } from '../dailyReportStorage';

test('rejects an old report-bound answer after revision while original evidence stays current', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-report-followup-red-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    const repository = createRecordRepository(connection.database);
    const reports = createDailyReportStorage(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready')
      throw new Error('Invalid calendar fixture');
    const identity = calendar.context.identity;
    await reports.lookup(identity);
    const cited = HealthObservationSchema.parse({
      id: 'synthetic-unchanged-observation',
      effectiveAt: '2035-01-01T01:00:00Z',
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });
    await repository.put('health_observation', cited);
    const sourceRevision = fingerprint(cited);
    const context = createDailyReportContext(
      calendar.context,
      {
        revision: 'synthetic-snapshot',
        ...(await readHealthContextGeneration(connection.database)),
        records: [
          {
            source: 'manual',
            recordId: cited.id,
            revision: sourceRevision,
            occurrence: { startInclusive: cited.effectiveAt! },
            ingestedAt: cited.ingestedAt,
          },
        ],
        coverage: [],
      },
      { providerId: 'synthetic-local', modelId: 'synthetic-model' },
    );
    const lineage = [
      {
        source: 'manual',
        recordId: cited.id,
        kind: 'health_observation' as const,
        localId: cited.id,
        revision: sourceRevision,
      },
    ];
    const report = (text: string, generatedAt: string) => ({
      schemaVersion: 1 as const,
      identity,
      generatedAt,
      observations: [
        { text, sourceReferences: [{ source: 'manual', recordId: cited.id }] },
      ],
      supportedContext: [],
      coverage: [],
      followUpQuestions: [],
    });
    expect(
      await reports.save({
        runId: 'daily-report-one',
        context,
        result: {
          status: 'completed',
          report: report('Original report', '2035-01-01T12:01:00Z'),
        },
        lineage,
        mode: { kind: 'initial' },
      }),
    ).toEqual({ status: 'saved' });

    const conversations = createConversationArtifactStorage(
      connection.database,
    );
    await conversations.createSession(
      'follow-up-session',
      await conversations.currentGeneration(),
    );
    const recordSource = {
      reference: {
        sourceKind: 'personal_record' as const,
        sourceId: cited.id,
        sourceRevision,
        evidenceId: cited.id,
        evidenceRevision: sourceRevision,
        locator: { kind: 'structured_record', recordId: cited.id },
        effectiveTime: cited.effectiveAt!,
        reviewState: 'unreviewed' as const,
        unit: 'count/min',
      },
      records: [
        {
          kind: 'health_observation' as const,
          id: cited.id,
          revision: sourceRevision,
        },
      ],
    };
    const lateTurn = {
      id: 'answer-from-report-revision-one',
      sessionId: 'follow-up-session',
      createdAt: '2035-01-01T12:02:00.000Z',
      providerId: 'synthetic-local',
      modelId: 'synthetic-model',
      status: 'complete' as const,
      question: 'What does this report mean?',
      answer: 'Synthetic answer based on revision one.',
      dailyReport: { identity, runId: 'daily-report-one', revision: 1 },
      sources: [recordSource],
      citations: [],
    };

    const historical = {
      ...lateTurn,
      id: 'already-committed',
      entryIntent: 'possibilities' as const,
      sources: [],
    };
    await conversations.append(historical);

    // This is the service's last current-revision check before finish/append.
    expect(await reports.lookup(identity)).toMatchObject({
      status: 'saved',
      runId: 'daily-report-one',
      revision: 1,
    });
    expect(
      await reports.save({
        runId: 'daily-report-two',
        context,
        result: {
          status: 'completed',
          report: report('Revised report', '2035-01-01T12:03:00Z'),
        },
        lineage,
        mode: { kind: 'revise', expectedRunId: 'daily-report-one' },
      }),
    ).toEqual({ status: 'saved' });
    expect(await reports.lookup(identity)).toMatchObject({
      status: 'saved',
      runId: 'daily-report-two',
      revision: 2,
    });

    let appendAccepted = true;
    try {
      await conversations.append(lateTurn);
    } catch {
      appendAccepted = false;
    }
    const unchanged = await repository.get('health_observation', cited.id);
    connection.close();

    connection = openSqliteTestDatabase(path);
    await runMigrations(connection.database);
    const reopenedStorage = createConversationArtifactStorage(
      connection.database,
    );
    const reopened = await reopenedStorage.read(lateTurn.id);
    expect(await reopenedStorage.read(historical.id)).toEqual(historical);
    const registry = new LocalEvidenceReferenceRegistry();
    const data = Object.assign(localData([]).data, {
      openConversationArtifactStorage: async () => reopenedStorage,
      conversationArtifactDiscovery: async () =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage: reopenedStorage,
          data,
          registry,
        }),
    });
    const options = createConversationSessionOptions({
      loadLocalData: async () => data,
      registry,
    });
    const turns = await options.restoreSession!(
      historical.sessionId,
      new AbortController().signal,
    );
    expect(turns).toMatchObject([
      { entryIntent: 'possibilities', dailyReport: historical.dailyReport },
    ]);
    const active = await createDailyReportStorage(connection.database).lookup(
      identity,
    );
    const actual = {
      appendAccepted,
      reopenedAnswer: reopened?.answer ?? null,
      activeReportRunId: active.status === 'saved' ? active.runId : null,
      originalEvidenceUnchanged:
        unchanged !== null && fingerprint(unchanged) === sourceRevision,
    };
    expect(actual).toEqual({
      appendAccepted: false,
      reopenedAnswer: null,
      activeReportRunId: 'daily-report-two',
      originalEvidenceUnchanged: true,
    });
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
