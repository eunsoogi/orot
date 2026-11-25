import { dailyReportDeviceAuthorityFixture } from '../testSupport/dailyReportDeviceAuthorityFixture';
import { expectAutomaticReportReference } from '../testSupport/dailyReportAutomaticMemoryAcceptance';
import { expectBookmarkSynchronousCommit } from '../testSupport/savedGeneratedReportCommitAcceptance';
import { expectReportBookmarkMounted } from '../testSupport/savedGeneratedReportBookmarkAcceptance';
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
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createDailyReportStorage } from '../dailyReportStorage';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../agent/execution/consentGeneration', () => {
  let sequence = 0;
  return {
    createConsentGeneration: () => (++sequence).toString(16).padStart(64, '0'),
  };
});

jest.mock('../../memory/openSavedGeneratedReportReferences', () => ({
  openSavedGeneratedReportReferences: jest.fn(),
}));

test.each(['explicit-local', 'semantic'] as const)(
  'bookmarks the original daily report and sweeps deleted roots: %s',
  async mode => {
    const device = dailyReportDeviceAuthorityFixture();
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
          {
            text,
            sourceReferences: [{ source: 'manual', recordId: cited.id }],
          },
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
      const historical = {
        id: 'already-committed',
        sessionId: 'follow-up-session',
        createdAt: '2035-01-01T12:02:00.000Z',
        providerId: 'synthetic-local',
        modelId: 'synthetic-model',
        status: 'complete' as const,
        question: 'What does this report mean?',
        answer: 'Synthetic answer based on revision one.',
        dailyReport: { identity, runId: 'daily-report-one', revision: 1 },
        sources: [],
        citations: [],
      };

      await conversations.startRequest({
        id: historical.id,
        question: historical.question,
        sessionId: historical.sessionId,
        sessionVersion: 0,
        createdAt: historical.createdAt,
      });
      await conversations.append(historical);

      const save = (version = 0, current = () => true) =>
        conversations.bookmarkDailyReport({
          artifactId: historical.id,
          lease: { id: historical.sessionId, version },
          current,
        });
      expect(await save(9)).toBe(false);
      expect(await save(0, () => false)).toBe(false);
      await expectReportBookmarkMounted(conversations, historical, mode);
      expect(await save()).toBe(true);
      expect(await save()).toBe(true);
      expect(await conversations.listSavedGeneratedReportReferences()).toEqual([
        { artifactId: historical.id, savedAt: expect.any(String) },
      ]);
      const saved = await conversations.readSavedGeneratedReportReference(
        historical.id,
        () => true,
      );
      expect(saved?.report.observations[0]?.text).toBe('Original report');
      expect(saved).not.toHaveProperty('answer');
      expect(
        await conversations.readSavedGeneratedReportReference(
          historical.id,
          () => false,
        ),
      ).toBeNull();
      await expectBookmarkSynchronousCommit(
        connection.database,
        path,
        historical,
      );
      const columns = await connection.database.execute(
        'PRAGMA table_info(saved_generated_report_refs)',
      );
      expect(columns.rows.map(row => row.name)).toEqual([
        'report_id',
        'artifact_id',
        'saved_at',
      ]);
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
      expect(
        await conversations.readSavedGeneratedReportReference(
          historical.id,
          () => true,
        ),
      ).toBeNull();
      expect(await save()).toBe(false);
      connection.close();
      connection = openSqliteTestDatabase(path);
      const reopened = createConversationArtifactStorage(connection.database);
      expect(await reopened.listSavedGeneratedReportReferences()).toHaveLength(
        1,
      );
      await expectAutomaticReportReference(
        reopened,
        historical,
        {
          identity,
          runId: 'daily-report-two',
          revision: 2,
        },
        device.lose,
      );
      await reopened.deleteSession(historical.sessionId);
      expect(await reopened.listSavedGeneratedReportReferences()).toEqual([]);
      expect(
        await reopened.readSavedGeneratedReportReference(
          historical.id,
          () => true,
        ),
      ).toBeNull();
      const table = await connection.database.execute(
        'SELECT COUNT(*) AS n FROM saved_generated_report_refs',
      );
      expect(table.rows[0]?.n).toBe(0);
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
