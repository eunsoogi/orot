import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import type {
  LanguageModelRequest,
  LanguageModelResponse,
} from '@orot/model-runtime';
import { ConversationScreen } from '../ConversationScreen';
import { ConversationSessionsProvider } from '../ConversationSessionsContext';
import type { ConversationExecutionAdapter } from '../conversationExecutionLease';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import { setup } from '../testSupport/continuousSessionFixture';
import { continuousSessionOption } from '../../aiFeatures/integration/continuousSessionOption';
import { createConversationSummaryIntegration } from '../../aiFeatures/integration/conversationSummaryIntegration';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createAppleSelectionOption } from '../../providers/selection/options';

jest.mock('../ConversationSavedRecaps', () => ({
  ConversationSavedRecaps: () => null,
}));
const prompt = '다음 진료에서 어떤 질문을 하면 좋을지 준비해 줘.';
const answer = {
  status: 'answer' as const,
  answer: 'Synthetic final',
  citations: [],
};

test.each([
  'visit-questions',
  'ordinary',
  'malformed',
  'changed-selection',
  'quick-return',
  'protected-data-lost',
  'request-interrupted',
] as const)(
  'strict selected Apple composer uses the common router: %s',
  async mode => {
    const f = await setup();
    const listeners = new Set<
      Parameters<ConversationExecutionAdapter['subscribe']>[0]
    >();
    let phase: NonNullable<
      ReturnType<NonNullable<ConversationExecutionAdapter['currentPhase']>>
    > = 'active';
    let selection = true;
    let protectedData = true;
    let expectedRequestId = '';
    let retainedSession = '';
    let retainedVersion = -1;
    let reply!: (response: LanguageModelResponse) => void;
    let dispatch!: () => void;
    const dispatched = new Promise<void>(resolve => {
      dispatch = resolve;
    });
    const generate = jest.fn(
      async (_request: LanguageModelRequest, _nativeId: string) => {
        const { rows } = await f.database.execute(
          "SELECT id, session_id, session_version FROM conversation_requests WHERE status='active'",
        );
        expect(rows).toHaveLength(1);
        expectedRequestId = String(rows[0]!.id);
        retainedSession = String(rows[0]!.session_id);
        retainedVersion = Number(rows[0]!.session_version);
        return new Promise<LanguageModelResponse>(resolve => {
          reply = resolve;
          dispatch();
        });
      },
    );
    const cancel = jest.fn();
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      generate,
      async *stream() {
        throw new Error('Not the proposal transport');
      },
      cancel,
    });
    const option = { ...createAppleSelectionOption('available'), provider };
    const selected = {
      status: 'ready' as const,
      selection: { providerId: provider.id, modelId: option.modelId },
      provider,
      modelId: option.modelId,
      option,
      remoteProcessing: false,
      recipient: 'Synthetic on-device',
    };
    const execution: ConversationExecutionAdapter = {
      bridgeAvailable: true,
      currentPhase: () => phase,
      protectedDataAvailable: async () => protectedData,
      begin: async () => true,
      isActive: async () => true,
      end: () => {},
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const finish: ConversationScreenProps['onSend'] = async (
      question,
      _history,
      signal,
      observer,
    ) => {
      expect(observer?.retentionRequestId).toBe(expectedRequestId);
      await observer?.onRetentionCandidate?.(
        {
          question,
          answer: answer.answer,
          providerId: provider.id,
          modelId: option.modelId,
          sources: [],
          citations: [],
        },
        signal!,
      );
      return answer;
    };
    const visit = jest.fn(finish);
    const rag = jest.fn(finish);
    const authorize = jest.fn(async () => 'renewal_required' as const);
    const app = createConversationSummaryIntegration({
      consent: { authorize },
      dependencies: {},
      loadData: jest.fn(async () => {
        throw new Error('Synthetic router cannot read health');
      }),
      selectedAi: async () => selected,
      registry: new LocalEvidenceReferenceRegistry(),
      diseaseRunner: jest.fn(),
      sendRagMessage: rag,
      loadSavedVisitQuestions: jest.fn(),
    });
    const options = {
      ...f.options,
      ...continuousSessionOption(
        async () => selected,
        async () => f.storage,
        () => id => (id === provider.id ? () => selection : null),
      ),
      execution,
    };
    const view = await render(
      <ConversationSessionsProvider options={options}>
        <ConversationScreen
          onSend={app.sendRagMessage}
          prepareVisitQuestions={visit}
          onBack={() => {}}
          onOpenSource={() => {}}
        />
      </ConversationSessionsProvider>,
    );
    try {
      await fireEvent.changeText(
        await screen.findByTestId('rag-conversation-input'),
        prompt,
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      await dispatched;
      const proposal = {
        id: 'fixture-proposal',
        name: 'propose_conversation_template',
        arguments: {
          intent: mode === 'ordinary' ? 'ordinary' : 'visit-questions',
          ...(mode === 'malformed' ? { modelAppointmentId: 'invalid' } : {}),
        },
      };
      await act(async () => {
        if (mode === 'changed-selection') selection = false;
        if (mode === 'protected-data-lost') protectedData = false;
        if (mode === 'request-interrupted')
          await f.storage.interruptRequest(
            expectedRequestId,
            retainedSession,
            retainedVersion,
            'interrupted',
            'provider-failed',
          );
        if (mode === 'quick-return') {
          phase = 'inactive';
          for (const listener of listeners) listener({ kind: 'phase' });
          phase = 'active';
          for (const listener of listeners) listener({ kind: 'foreground' });
        }
        reply({ text: '', finishReason: 'tool_calls', toolCalls: [proposal] });
      });
      const retired =
        mode === 'changed-selection' ||
        mode === 'quick-return' ||
        mode === 'protected-data-lost' ||
        mode === 'request-interrupted';
      if (!retired) await screen.findByText(answer.answer);
      else await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
      expect(generate).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledWith(generate.mock.calls[0]![1]);
      expect(generate.mock.calls[0]![0]).toMatchObject({
        toolChoice: 'required',
      });
      expect(
        generate.mock.calls[0]![0].messages.filter(x => x.role !== 'system'),
      ).toEqual([{ role: 'user', content: prompt }]);
      expect(authorize).not.toHaveBeenCalled();
      expect(visit).toHaveBeenCalledTimes(Number(mode === 'visit-questions'));
      expect(rag).toHaveBeenCalledTimes(
        Number(mode === 'ordinary' || mode === 'malformed'),
      );
      const completed = await f.storage.listCompletionIdentities();
      expect(completed.map(row => row.requestId)).toEqual(
        retired ? [] : [expectedRequestId],
      );
    } finally {
      await view.unmount();
      f.close();
    }
  },
);
