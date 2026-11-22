import { act, render, waitFor } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { finishRagConversation } from '../../aiFeatures/integration/finishRagConversation';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { ConversationExecutionEvent } from '../conversationExecutionLease';
import { createConversationSessionRetention } from '../conversationSessionRetention';
import { createConversationSessions } from '../conversationSessions';
import type { ConversationSender } from '../conversationSessionTypes';
import { Transcript, at } from '../testSupport/savedHistoryDisplayFixture';
import { t } from '../../i18n';

function hold() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const prompt = 'Synthetic completed question';
const answer = 'Synthetic validated final answer';
const opening = '함께 내용을 살펴볼게요.';

test.each([
  'after-display',
  'after-display-lock',
  'while-generating',
  'explicit-stop',
] as const)(
  'only unfinished owned model work presents an interruption: %s',
  async timing => {
    const dir = mkdtempSync(join(tmpdir(), 'orot-final-display-fence-'));
    const connection = openSqliteTestDatabase(join(dir, 'test.sqlite'));
    const storage = createConversationArtifactStorage(connection.database);
    const afterDisplay = timing.startsWith('after-display');
    const ids = ['synthetic-session', 'synthetic-turn'];
    const tool = hold();
    const model = hold();
    const toolEntered = hold();
    const modelEntered = hold();
    let leaseId = '';
    let sendSignal: AbortSignal | undefined;
    let listener!: (event: ConversationExecutionEvent) => void;
    const live = createConversationSessions({
      retention: createConversationSessionRetention({
        openStorage: async () => ({
          ...storage,
          async appendToolEvent(value) {
            if (afterDisplay) {
              toolEntered.resolve();
              await tool.promise;
            }
            return storage.appendToolEvent(value);
          },
        }),
        now: () => at(1),
        createId: () => ids.shift()!,
      }),
      execution: {
        bridgeAvailable: true,
        currentPhase: () => 'active',
        begin: async id => {
          leaseId = id;
          return true;
        },
        end: jest.fn(),
        isActive: async () => true,
        protectedDataAvailable: async () => true,
        subscribe: callback => {
          listener = callback;
          return () => {};
        },
      },
    });
    const sender: jest.MockedFunction<ConversationSender> = jest.fn(
      async (question, _history, signal, observer) => {
        sendSignal = signal;
        observer?.onTaskStreamEvent?.({
          type: 'initial_response',
          callId: 'reviewed-synthetic-opening',
          text: opening,
        });
        if (!afterDisplay) {
          modelEntered.resolve();
          await model.promise;
          expect(signal?.aborted).toBe(true);
          return { status: 'failure', kind: 'cancelled' } as const;
        }
        observer?.onToolEvent?.({
          version: 1,
          operationRunId: 'synthetic-run',
          callId: 'synthetic-call',
          toolName: 'local-health-context',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind: 'personal_record' },
          sources: [],
        });
        const retention = createConversationRetentionBridge({
          signal: signal!,
          observer,
          question,
          providerId: 'fixture-provider',
          modelId: 'fixture-model',
          registry: new LocalEvidenceReferenceRegistry(),
        });
        retention.onValidatedEvidence([]);
        return finishRagConversation({
          outcome: { status: 'answer', answer, citations: [] },
          publicSearch: { status: 'success' },
          retention,
          signal: signal!,
          continuation: false,
        });
      },
    );
    let send: Promise<unknown> | undefined;
    const mounted = await render(<Transcript store={live} />);
    try {
      await runMigrations(connection.database);
      await storage.currentGeneration();
      if (afterDisplay)
        await connection.database.execute(
          "CREATE TRIGGER synthetic_answer_save_failure BEFORE INSERT ON conversation_artifacts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
        );
      await act(async () => {
        live.setDraft(1, prompt);
        send = live.send(1, sender);
        await (afterDisplay ? toolEntered.promise : modelEntered.promise);
      });
      const session = () => live.getSnapshot().sessions[0]!;
      if (afterDisplay) {
        await waitFor(() => expect(mounted.getByText(answer)).toBeTruthy());
        expect(mounted.getByText(opening)).toBeTruthy();
        expect(session().unsavedCount).toBe(1);
        expect(session().busy).toBe(true);
        expect(session().pendingMessage).toBeNull();
      }
      // A different acquired lease identity is never accepted.
      await act(() => listener({ kind: 'expired', requestId: 'alien-lease' }));
      expect(session().busy).toBe(true);
      await act(async () => {
        if (timing === 'explicit-stop') live.cancel(1);
        else listener({ kind: 'expired', requestId: leaseId });
        if (afterDisplay) expect(sendSignal?.aborted).toBe(false);
        if (timing === 'after-display-lock') {
          listener({ kind: 'protectedData', available: false });
          expect(sendSignal?.aborted).toBe(true);
        }
        model.resolve();
        tool.resolve();
        await send;
      });
      expect(await storage.listCompletionIdentities()).toEqual([]);
      expect(sender).toHaveBeenCalledTimes(1);
      expect(session().busy).toBe(false);
      if (timing === 'after-display-lock') {
        expect(
          await storage.listInterruptedRequests('synthetic-session', 0),
        ).toMatchObject([{ interruptionReason: 'protected-data' }]);
      } else if (afterDisplay) {
        expect(
          session().messages.filter(row => row.role === 'assistant'),
        ).toHaveLength(1);
        expect(mounted.getByText(answer)).toBeTruthy();
        expect(mounted.getByText(opening)).toBeTruthy();
        expect(session().messages[0]?.failed).not.toBe(true);
        expect(session().draft).toBe('');
        expect(session().unsavedCount).toBe(1);
        expect(session().error).toBe(
          t('ragConversation.conversation.answerSaveFailed'),
        );
        expect(
          (
            await connection.database.execute(
              'SELECT status, interruption_reason FROM conversation_requests',
            )
          ).rows,
        ).toEqual([{ status: 'active', interruption_reason: null }]);
        await connection.database.execute(
          'DROP TRIGGER synthetic_answer_save_failure',
        );
        await act(() => live.retrySave(1));
        expect(session().unsavedCount).toBe(0);
        expect(
          session().messages.filter(row => row.role === 'assistant'),
        ).toHaveLength(1);
        expect(
          await storage.readCommittedCompletion({
            requestId: 'synthetic-turn',
            messageId: 'synthetic-turn',
            sessionId: 'synthetic-session',
            sessionVersion: 0,
          }),
        ).toBe(answer);
        expect(sender).toHaveBeenCalledTimes(1);
      } else {
        expect(mounted.queryByText(answer)).toBeNull();
        expect(mounted.getByText(opening)).toBeTruthy();
        expect(session().messages[0]?.failed).toBe(true);
        expect(session().draft).toBe(prompt);
        expect(session().messages[1]?.incomplete).toBe(true);
        expect(
          await storage.listInterruptedRequests('synthetic-session', 0),
        ).toMatchObject([
          {
            interruptionReason:
              timing === 'explicit-stop' ? 'user-stopped' : 'expired',
          },
        ]);
      }
    } finally {
      model.resolve();
      tool.resolve();
      await send?.catch(() => {});
      await mounted.unmount();
      live.dispose();
      connection.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
