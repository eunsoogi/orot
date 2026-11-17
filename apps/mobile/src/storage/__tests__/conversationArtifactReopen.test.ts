import { ragConversationTask } from '../../ragConversation/task';
import { parseConversationReport } from '../../ragConversation/conversationReportTemplate';
import { t } from '../../i18n';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test.each(['ordinary', 'structured report'])(
  'reopen preserves %s and an empty-corpus wipe fences late sessions and writes',
  async kind => {
    let answer = 'answer';
    if (kind === 'structured report') {
      const validated = ragConversationTask.validateResult(
        {
          answerKind: 'grounded',
          answer: {
            observations: 'Synthetic observation',
            explanations: 'Synthetic tentative explanation',
            evidence: 'Synthetic evidence limits',
            unknowns: 'Synthetic unknown',
            nextSteps: 'Synthetic clinician question',
          },
        },
        {
          request: t('conversationActions.possibilities'),
          evidence: {
            items: [
              {
                sourceKind: 'personal_record',
                sourceId: 'synthetic',
                sourceRevision: '1',
                evidenceId: 'synthetic',
                evidenceRevision: '1',
                locator: {},
                effectiveTime: null,
                reviewState: 'reviewed',
                content: 'Synthetic observation',
              },
            ],
            coverage: [],
            conflicts: [],
          },
        },
      );
      if (validated.status !== 'valid') throw new Error('Expected report');
      answer = validated.value.answer;
    }
    const directory = mkdtempSync(join(tmpdir(), 'orot-conversation-'));
    const path = join(directory, 'records.sqlite');
    let connection = openSqliteTestDatabase(path);
    try {
      await runMigrations(connection.database);
      let storage = createConversationArtifactStorage(connection.database);
      const epoch = await storage.currentGeneration();
      await storage.createSession('session', epoch);
      await storage.deleteSession('pending');
      const value = {
        id: 'turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete' as const,
        question: 'question',
        answer,
        delivery: {
          submittedAt: '2026-10-05T00:00:00.000Z',
          acceptedAt: '2026-10-05T00:00:01.000Z',
          readAt: '2026-10-05T00:00:02.000Z',
        },
        initialResponse: { callId: 'opening', text: '질문에 맞춰 살펴볼게요.' },
        entryIntent: 'possibilities' as const,
        priorDialogue: [
          { question: 'earlier report', answer: 'follow-up question' },
        ],
        priorUserReports: ['earlier report'],
        sources: [],
        citations: [],
      };
      await storage.append(value);
      await storage.append({ ...value, id: 'turn-2' });
      const page = await storage.list('session', undefined, 1);
      expect(page.items.map(item => item.id)).toEqual(['turn-2']);
      expect(
        (await storage.list('session', page.nextCursor!, 1)).items.map(
          item => item.id,
        ),
      ).toEqual(['turn']);
      connection.close();
      connection = openSqliteTestDatabase(path);
      storage = createConversationArtifactStorage(connection.database);
      expect(await storage.read('turn')).toEqual(value);
      if (kind === 'structured report')
        expect(
          parseConversationReport((await storage.read('turn'))!.answer)
            ?.sections,
        ).toHaveLength(5);
      await expect(storage.createSession('pending', epoch)).rejects.toThrow();
      await createRecordRepository(connection.database).deleteAllLocalData();
      expect(await storage.read('turn')).toBeNull();
      await expect(storage.append(value)).rejects.toThrow();
      await expect(storage.createSession('late', epoch)).rejects.toThrow();
      expect(await storage.currentGeneration()).toBe(epoch + 1);
      connection.close();
      connection = openSqliteTestDatabase(path);
      storage = createConversationArtifactStorage(connection.database);
      expect(await storage.read('turn')).toBeNull();
      expect(
        (
          await connection.database.execute(
            'SELECT result_json FROM conversation_artifacts',
          )
        ).rows,
      ).toEqual([]);
    } finally {
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
