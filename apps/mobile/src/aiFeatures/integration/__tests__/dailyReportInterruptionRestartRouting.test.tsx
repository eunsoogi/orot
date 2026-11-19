import { Alert } from 'react-native';
import { act, render, screen, fireEvent } from '@testing-library/react-native';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../../../ragConversation/conversationSessionRetention';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { ConversationScreen } from '../../../ragConversation/ConversationScreen';
import { useConversationSessions } from '../../../ragConversation/ConversationSessionsContext';
import { entryIntentSender } from '../../../ragConversation/entryIntentSender';
import { setConversationEntryForSession } from '../../../ragConversation/useConversationEntryIntent';
import { createDailyReportIdentity } from '@orot/domain';
jest.mock('../../../ragConversation/ConversationSessionsContext', () => ({
  useConversationSessions: jest.fn(),
}));
import type { ConversationExecutionEvent } from '../../../ragConversation/conversationExecutionLease';
import { createColdConversationServices } from '../coldConversationServices';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createDailyReportRequests } from '../dailyReportRequests';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import type { ConversationScreenProps } from '../../../ragConversation/ConversationScreenProps';
import { dailyReportConversationFailure } from '../dailyReportConversationFailure';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  reportService,
} from '../testSupport/dailyReportFailureStageFixtures';

// Actual screen restart routing after a synthetic OS interruption of the real daily service.
// Confirmed replacement calls the real coordinator/service with an in-memory model only.
test.each(['same-day', 'changed-day'] as const)(
  'confirmed daily restart preserves scope and current-day dispatch fence: %s',
  async boundary => {
    const reason = 'expired';
    const db = openSqliteTestDatabase(':memory:');
    const forbidden = jest.fn((): never => {
      throw new Error('Inspection must not execute a provider or authorize');
    });
    const cold = createColdConversationServices(
      {
        consent: { authorize: async () => forbidden() },
        queryConsent: { authorize: async () => forbidden() },
        get externalEvidence() {
          return forbidden();
        },
        loadLocalData: async () => forbidden(),
        selectedAi: async () => forbidden(),
        registry: new LocalEvidenceReferenceRegistry(),
        ragRunner: async () => forbidden(),
      },
      async () => db.database,
    );
    const inspect = jest.spyOn(cold, 'inspect');
    let receive!: (event: ConversationExecutionEvent) => void;
    const begin = jest.fn(async (_requestId: string) => true);
    let finish!: () => void, modelStarted!: () => void;
    const gate = new Promise<void>(resolve => {
      finish = resolve;
    });
    const started = new Promise<void>(resolve => {
      modelStarted = resolve;
    });
    const model = reportProvider();
    const originalGenerate = model.generate.bind(model);
    const generate = jest
      .spyOn(model, 'generate')
      .mockImplementation(async input => {
        modelStarted();
        await gate;
        return originalGenerate(input);
      });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let sessions: ReturnType<typeof createConversationSessions> | undefined;
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      await prepareReportDatabase(db.database);
      const storage = createConversationArtifactStorage(db.database);
      let sequence = 0;
      const retention = createConversationSessionRetention({
        openStorage: async () => storage,
        createId: () => `synthetic-${++sequence}`,
        now: () => '2035-01-01T12:00:00.000Z',
      });
      sessions = createConversationSessions({
        retention,
        coldResume: cold,
        execution: {
          begin,
          end: () => {},
          protectedDataAvailable: async () => true,
          isActive: async () => true,
          subscribe: listener => {
            receive = listener;
            return () => {};
          },
        },
      });
      const service = reportService(db.database, model, {
        remoteProcessing: true,
      });
      const identity = createDailyReportIdentity('2035-01-01', 'UTC');
      setConversationEntryForSession(sessions, 1, {
        intent: 'daily-report',
        entryKey: 'synthetic-daily',
        reportRequest: identity,
      });
      sessions.setDraft(1, '합성 일일보고서');
      const pending = sessions.send(
        1,
        entryIntentSender(
          sessions,
          1,
          async (_question, _history, signal, observer, entry) => {
            expect(entry?.reportRequest).toEqual(identity);
            const result = await service({
              ...reportRequest(signal),
              observer,
            });
            if (result.status !== 'failed')
              throw new Error('Expected interrupted synthetic request');
            return dailyReportConversationFailure(result.code);
          },
        ),
      );
      // Fail immediately if the synthetic sender never reaches the provider, rather than
      // misreporting fixture setup failure as a suspended model operation.
      await Promise.race([
        started,
        pending.then(() => {
          throw new Error('Synthetic sender ended before reaching the model');
        }),
      ]);
      receive({ kind: 'expired', requestId: begin.mock.calls[0]![0] });
      finish();
      await pending;
      const session = sessions.getSnapshot().sessions[0]!;
      expect(session.continueWorkflow).toBeUndefined();
      expect(session.messages.at(-1)).toMatchObject({
        incomplete: true,
        interruptionReason: reason,
      });
      jest.mocked(useConversationSessions).mockReturnValue(sessions);
      let current = identity;
      const requests = createDailyReportRequests({
        lookup: createDailyReportStorage(db.database).lookup,
        currentIdentity: () => current,
        run: (requested, mode, signal, observer) =>
          service({
            timeZone: requested.timeZone,
            scope: {},
            mode,
            signal,
            observer,
          }),
      });
      const sender: ConversationScreenProps['onSend'] = async (
        _question,
        _history,
        signal,
        observer,
        entry,
      ) => {
        if (!entry?.reportRequest)
          return { status: 'failure', kind: 'unavailable' };
        const operation = requests.start(
          entry.reportRequest,
          { kind: 'reuse_or_generate' },
          observer,
          signal,
        );
        if (operation.status !== 'started')
          return { status: 'failure', kind: 'unavailable' };
        const result = await operation.result;
        return result.status === 'failed'
          ? dailyReportConversationFailure(result.code)
          : { status: 'answer', answer: '합성 새 처리 결과', citations: [] };
      };
      const restart = jest.fn(sender);
      view = await render(
        <ConversationScreen
          onBack={jest.fn()}
          onOpenSource={jest.fn()}
          onSend={restart}
        />,
      );
      expect(screen.queryByText('작업 이어하기')).toBeNull();
      expect(inspect).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(1);
      await fireEvent.press(screen.getByText('이어갈 수 있는지 확인'));
      // The direct daily path has no pre-result graph checkpoint or tool metadata.
      // The real refresh action rejects locally; it must not invent a cold continuation.
      expect(session.messages.at(-1)?.toolMessageId).toBeUndefined();
      expect(inspect).not.toHaveBeenCalled();
      expect(screen.getByText(/이어갈 저장 지점이 없어요/)).toBeTruthy();
      expect(forbidden).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(restart).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByText('다시 요청'));
      expect(alert.mock.calls.at(-1)?.[1]).toContain('추가 API 비용');
      expect(restart).not.toHaveBeenCalled();
      await act(async () => {
        alert.mock.calls.at(-1)?.[2]?.[0]?.onPress?.();
      });
      expect(restart).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByText('다시 요청'));
      if (boundary === 'changed-day')
        current = createDailyReportIdentity('2035-01-02', 'UTC');
      await act(async () => {
        const confirm = alert.mock.calls.at(-1)?.[2]?.[1]?.onPress;
        confirm?.();
        confirm?.(); // Same pending confirmation cannot enqueue another request.
      });
      expect(restart).toHaveBeenCalledTimes(1);
      expect(restart.mock.calls[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            intent: 'daily-report',
            reportRequest: identity,
          }),
        ]),
      );
      await act(async () => {
        await restart.mock.results[0]!.value;
      });
      const newCalls = generate.mock.calls.slice(1);
      // Live conversations already generate an optional opening separately from the report.
      expect(newCalls).toHaveLength(boundary === 'same-day' ? 2 : 0);
      const reportCalls = newCalls.filter(([request]) =>
        request.messages.some(message => {
          if (!('content' in message)) return false;
          try {
            return Array.isArray(JSON.parse(message.content as string).facts);
          } catch {
            return false;
          }
        }),
      );
      expect(reportCalls).toHaveLength(boundary === 'same-day' ? 1 : 0);
      expect(await requests.lookup(identity)).toMatchObject({
        status: boundary === 'same-day' ? 'saved' : 'missing',
      });
    } finally {
      finish();
      await view?.unmount();
      sessions?.dispose();
      alert.mockRestore();
      db.close();
    }
  },
);
