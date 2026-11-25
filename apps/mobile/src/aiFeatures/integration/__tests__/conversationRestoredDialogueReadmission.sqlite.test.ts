import { createDailyReportIdentity } from '@orot/domain';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import {
  consumeConversationEntryForSession,
  conversationEntryForSession,
  setConversationEntryForSession,
} from '../../../ragConversation/useConversationEntryIntent';
import type { ConversationEntryContext } from '../conversationIntent';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

const selectedHistory = [
  { id: 'older', question: 'Synthetic older question' },
  { id: 'newer', question: 'Synthetic safe question' },
] as const;

test.each([
  'ordinary',
  'consumed daily task',
  'targeted summary',
  'selected report',
  'retired owner',
  'second retirement',
  'cancelled',
] as const)(
  'readmits only safe restored dialogue before a first composer dispatch: %s',
  async mode => {
    const f = await quarantinedHistoryFixture();
    const sessions = createConversationSessions();
    const signal = new AbortController();
    const identity = createDailyReportIdentity('2026-10-06', 'UTC');
    let entry: ConversationEntryContext | undefined;
    const { activeId } = sessions.getSnapshot();
    if (mode === 'consumed daily task') {
      setConversationEntryForSession(sessions, activeId, {
        intent: 'daily-report',
        entryKey: 'synthetic-consumed-report',
        reportRequest: identity,
      });
      expect(
        consumeConversationEntryForSession(sessions, activeId)?.intent,
      ).toBe('daily-report');
      entry = conversationEntryForSession(sessions, activeId);
      expect(entry).toMatchObject({
        intent: 'conversation',
        reportRequest: identity,
      });
    }
    if (mode === 'targeted summary')
      entry = { intent: 'health-summary', entryKey: 'synthetic-summary' };
    if (mode === 'selected report')
      entry = {
        intent: 'conversation',
        entryKey: 'synthetic-selected-report',
        dailyReport: { identity, runId: 'missing-report', revision: 1 },
      };

    const readProtected = f.storage.readProtectedPromptHistory;
    const read = jest
      .spyOn(f.storage, 'readProtectedPromptHistory')
      .mockImplementation(async (...args) => {
        const result = await readProtected(...args);
        if (read.mock.calls.length === 1) {
          // Retire a real saved parent after it was projected, not before the query.
          expect(result?.map(item => item.id)).toEqual(['older', 'newer']);
          if (mode === 'retired owner')
            await f.storage.deleteSession('session');
          else if (mode === 'cancelled') signal.abort();
          else
            await f.database.execute(
              'DELETE FROM conversation_artifacts WHERE id = ?',
              ['older'],
            );
        } else if (mode === 'second retirement') {
          expect(result?.map(item => item.id)).toEqual(['newer']);
          await f.database.execute(
            'DELETE FROM conversation_artifacts WHERE id = ?',
            ['newer'],
          );
        }
        return result;
      });
    try {
      const provider = publicEvidenceFixture();
      const generate = jest.fn(async () => {
        throw new Error('A real provider boundary must never be invoked.');
      });
      const runner = jest.fn<
        ReturnType<typeof runRagConversationTurn>,
        Parameters<typeof runRagConversationTurn>
      >(async () => ({
        status: 'answer',
        answer: 'Synthetic safe current answer',
        citations: [],
      }));
      const send = createRagConversationService({
        ...f.input,
        consent: provider.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: { search: jest.fn() },
        selectedAi: async () => ({
          ...provider.selected,
          provider: {
            ...provider.selected.provider,
            generate,
            searchPublicWeb: undefined,
          },
        }),
        ragRunner: runner,
      });
      const outcome = await send(
        '안녕하세요',
        selectedHistory.map(({ question }) => ({
          role: 'user',
          content: question,
        })),
        signal.signal,
        {
          inputOrigin: 'composer',
          retentionSession: { id: 'session', version: 0 },
          retainedHistory: selectedHistory,
        },
        entry,
      );
      const resumes = mode === 'ordinary' || mode === 'consumed daily task';
      if (resumes) {
        expect(outcome).toMatchObject({
          status: 'answer',
          answer: expect.stringContaining(
            '확인할 수 없는 일부 이전 대화는 답변에 반영하지 않았어요.',
          ),
        });
        expect(runner).toHaveBeenCalledTimes(1);
        expect(runner.mock.calls[0]?.[0]).toMatchObject({
          priorDialogueOmitted: true,
          validatedPriorTurns: [
            {
              question: 'Synthetic safe question',
              answer: 'Synthetic safe answer',
            },
          ],
        });
        expect(runner.mock.calls[0]?.[0].previousMessages).toEqual([
          { role: 'user', content: 'Synthetic safe question' },
          { role: 'assistant', content: '' },
        ]);
        expect(await f.storage.read('older')).toBeNull();
        expect((await f.storage.read('newer'))?.answer).toBe(
          'Synthetic safe answer',
        );
      } else {
        expect(outcome).toMatchObject({ status: 'failure' });
        expect(runner).not.toHaveBeenCalled();
      }
      expect(read).toHaveBeenCalledTimes(
        mode === 'selected report'
          ? 0
          : mode === 'targeted summary' || mode === 'cancelled'
            ? 1
            : 2,
      );
      expect(generate).not.toHaveBeenCalled();
      expect(provider.search).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      sessions.dispose();
      f.close();
    }
  },
);
