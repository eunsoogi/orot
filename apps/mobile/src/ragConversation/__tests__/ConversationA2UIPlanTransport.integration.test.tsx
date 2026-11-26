import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeBridge,
  type ChatGPTPlanNativeEvent,
  type ChatGPTPlanRequest,
} from '@orot/provider-openai';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, NativeModules } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
  localA2UIChoices,
} from '../conversationA2UILocalDraft';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../conversationA2UILocalDraftOwner';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import {
  answer,
  base,
  choice,
  final,
  seedCheck,
  seedChoice,
} from '../testSupport/a2uiLocalFormFixtures';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';

function fakePlan(text: string) {
  const listeners = new Set<(event: ChatGPTPlanNativeEvent) => void>();
  const requests: ChatGPTPlanRequest[] = [];
  const model = { slug: 'gpt-test', displayName: 'Synthetic Plan model' };
  const emit = (event: ChatGPTPlanNativeEvent) => {
    for (const listener of listeners) listener(event);
  };
  const bridge: ChatGPTPlanNativeBridge = {
    async listModels() {
      return [model];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async startResponse(requestId, _client, request) {
      requests.push(request);
      emit({
        type: 'response_started',
        requestId,
        responseId: 'synthetic-response',
      });
      emit({ type: 'text_delta', requestId, text });
      emit({ type: 'completed', requestId, text });
    },
    cancelResponse: jest.fn(),
  };
  return {
    provider: createChatGPTPlanProvider({
      bridge,
      issuedClientID: 'synthetic-account',
      model,
    }),
    requests,
  };
}

function inspectTaskGuide(request: ChatGPTPlanRequest) {
  for (const message of request.messages) {
    if (!('role' in message) || message.role !== 'user') continue;
    try {
      const decoded: unknown = JSON.parse(message.content);
      if (decoded && typeof decoded === 'object' && 'responseSchema' in decoded)
        return decoded.responseSchema;
    } catch {
      // Normal composer messages are plain text, not output guidance.
    }
  }
  throw new Error('The Plan request did not receive JSON schema guidance.');
}

const accepted = [base, seedCheck, seedChoice, final()];
const wrongPath = [
  base,
  seedCheck,
  seedChoice,
  final({ ...choice, value: { '@path': localA2UICheckPath } }),
];
const objectFrames = accepted.map(value => JSON.parse(value) as unknown);
const cases = [
  { title: 'paired frames', frames: accepted, valid: true },
  {
    title: 'object frames',
    frames: objectFrames,
    valid: true,
  },
  {
    title: 'unrecognized object command',
    frames: [...objectFrames, { upload: {} }],
    valid: false,
  },
  { title: 'omitted frames', frames: undefined, valid: false },
  { title: 'empty frames', frames: [], valid: false },
  { title: 'unowned binding', frames: wrongPath, valid: false },
];

test.each(cases)(
  'the real ChatGPT Plan adapter sends guidance and mounts $title safely',
  async ({ frames, valid }) => {
    const previousPhase = AppState.currentState;
    const previousDiagnostics = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    AppState.currentState = 'active';
    const motion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const model = fixture();
    const plan = fakePlan(
      JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer,
          ...(frames ? { a2uiFrames: frames } : {}),
        },
        citations: [],
      }),
    );
    const store = createConversationSessions();
    function Scene() {
      const snapshot = useConversationPresentationSnapshot(store);
      const session = snapshot.sessions.find(
        item => item.id === snapshot.activeId,
      )!;
      const owner = useConversationA2UILocalDraftOwner(store, session.id);
      return (
        <NavigationMotionContext.Provider value>
          <ConversationA2UILocalDraftOwner.Provider value={owner}>
            <ConversationTranscriptMessages
              messages={session.messages}
              instructions={undefined}
              replyFocus={undefined}
              onLayout={jest.fn()}
              messageProps={{
                onOpenSource: jest.fn(),
                onLinkError: jest.fn(),
              }}
            />
          </ConversationA2UILocalDraftOwner.Provider>
        </NavigationMotionContext.Provider>
      );
    }
    try {
      const view = await render(<Scene />);
      try {
        await act(async () => {
          store.setDraft(1, '두 선택지를 비교하고 임시 확인란을 보여 주세요.');
          await store.send(1, (question, previousMessages, signal) =>
            runRagConversationTurn(
              {
                ...model.options,
                question,
                previousMessages,
                loadCurrentEvidence: async () => ({
                  batch: { items: [], coverage: [], conflicts: [] },
                  chunks: [],
                }),
                workflow: {
                  ...model.options.workflow,
                  provider: plan.provider,
                  execution: {
                    ...model.options.workflow.execution,
                    providerId: plan.provider.id,
                    modelId: plan.provider.id,
                  },
                },
              },
              { signal },
            ),
          );
        });
        expect(model.generate).not.toHaveBeenCalled();
        expect(plan.provider.capabilities.structuredOutput).toBe(false);
        expect(plan.requests).toHaveLength(1);
        const envelopeReceipts = report.mock.calls.filter(
          call => call[1] === 'conversation_a2ui_plan_envelope',
        );
        expect(envelopeReceipts).toEqual([
          [
            'rag',
            'conversation_a2ui_plan_envelope',
            frames ? 'present' : 'absent',
          ],
        ]);
        const request = plan.requests[0]!;
        expect(request).not.toHaveProperty('responseFormat');
        const guide = JSON.stringify(inspectTaskGuide(request));
        expect(guide).toContain('"a2uiFrames"');
        expect(guide).toContain('do not quote or double-encode');
        expect(guide).toContain('"required":["createSurface"]');
        expect(guide).not.toContain('/local/checked');
        expect(guide).toContain('/form/choice');
        expect(guide).toContain('multipleSelection');
        expect(guide).not.toContain('Use exactly first and second');

        const last = store.getSnapshot().sessions[0]?.messages.at(-1);
        expect(last?.content).toBe(answer);
        if (valid) {
          expect(last?.a2uiPresentation?.component).toBe('Column');
          expect(await screen.findByLabelText(localA2UICheckLabel)).toHaveProp(
            'value',
            false,
          );
          expect(
            screen.getByRole('radio', { name: localA2UIChoices[0].label }),
          ).toBeVisible();
        } else {
          expect(last?.a2uiPresentation).toBeUndefined();
          await waitFor(() => {
            const body = screen.getByTestId('rag-conversation-answer-body');
            expect(body).toBeVisible();
            expect(body).toHaveTextContent(answer, {
              exact: true,
              normalizer: text => text,
            });
          });
          expect(screen.queryByLabelText(localA2UICheckLabel)).toBeNull();
          expect(screen.queryByRole('radiogroup')).toBeNull();
        }
      } finally {
        await view.unmount();
      }
    } finally {
      store.dispose();
      motion.mockRestore();
      AppState.currentState = previousPhase;
      NativeModules.OrotProviderDiagnostics = previousDiagnostics;
    }
  },
);
