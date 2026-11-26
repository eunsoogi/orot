import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import {
  localA2UICheckLabel,
  localA2UICheckPath,
  localA2UIChoicePath,
  localA2UIChoices,
} from '../conversationA2UILocalDraft';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../conversationA2UILocalDraftOwner';
import { projectConversationLocalForm } from '../conversationA2UILocalFormFrames';
import { createConversationSessions } from '../conversationSessions';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';
import {
  answer,
  base,
  choice,
  final,
  frame,
  parts,
  seedCheck,
  seedChoice,
} from '../testSupport/a2uiLocalFormFixtures';

test.each([
  {
    title: 'foreign seed',
    wire: [
      base,
      seedCheck,
      frame(
        'updateDataModel',
        { path: localA2UIChoicePath, value: [] },
        'foreign',
      ),
      final(),
    ],
  },
  {
    title: 'wrong path',
    wire: [
      base,
      seedCheck,
      seedChoice,
      final({ ...choice, value: { '@path': localA2UICheckPath } }),
    ],
  },
  {
    title: 'user action',
    wire: [
      base,
      seedCheck,
      seedChoice,
      final({ ...choice, action: { event: { name: 'send' } } }),
    ],
  },
  {
    title: 'prefilled choice',
    wire: [
      base,
      seedCheck,
      frame('updateDataModel', { path: localA2UIChoicePath, value: ['first'] }),
      final(),
    ],
  },
])('rejects $title', ({ wire }) =>
  expect(projectConversationLocalForm(wire)).toBeUndefined(),
);

test('v41 leaves the paired wire as ordinary accepted prose', () => {
  const previous = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '41',
  });
  if (!previous) throw new Error('Expected historical Conversation v41.');
  const input = {
    request: '비교해 줘.',
    evidence: { items: [], coverage: [], conflicts: [] },
    context: [],
  } as Parameters<typeof previous.validateResult>[1];
  const value = {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [base, seedCheck, seedChoice, final()],
  };
  expect(previous.validateResult(value, input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});

test.each([true, false])(
  'real paired surface edits, retires, and rejects unsolicited actions: %s',
  async permitted => {
    const oldState = AppState.currentState;
    AppState.currentState = 'active';
    const motion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const model = fixture();
    const store = createConversationSessions();
    model.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer,
          a2uiFrames: [
            base,
            seedCheck,
            seedChoice,
            permitted
              ? final()
              : final({ ...choice, action: { event: { name: 'send' } } }),
          ],
        },
        citations: [],
      }),
    );
    function Scene() {
      const snapshot = useConversationPresentationSnapshot(store);
      const session = snapshot.sessions.find(
        item => item.id === snapshot.activeId,
      )!;
      const owner = useConversationA2UILocalDraftOwner(store, session.id);
      return (
        <ConversationA2UILocalDraftOwner.Provider value={owner}>
          <ConversationTranscriptMessages
            messages={session.messages}
            instructions={undefined}
            replyFocus={undefined}
            onLayout={jest.fn()}
            messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
          />
        </ConversationA2UILocalDraftOwner.Provider>
      );
    }
    try {
      const ui = await render(
        <NavigationMotionContext.Provider value>
          <Scene />
        </NavigationMotionContext.Provider>,
      );
      try {
        await act(async () => {
          store.setDraft(1, '두 부분을 비교하고 임시 확인 표시를 넣어 주세요.');
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
              },
              { signal },
            ),
          );
        });
        const root = store
          .getSnapshot()
          .sessions[0]?.messages.at(-1)?.a2uiPresentation;
        if (!permitted) {
          expect(root).toBeUndefined();
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
          expect(model.generate).toHaveBeenCalledTimes(1);
          return;
        }
        if (!root) throw new Error('Expected an owned final paired surface.');
        const toggle = () => screen.getByLabelText(localA2UICheckLabel);
        const selected = () =>
          screen.getByRole('radio', { name: localA2UIChoices[1].label });
        expect(toggle()).toHaveProp('value', false);
        expect(selected()).toHaveProp('accessibilityState', { checked: false });
        await fireEvent(toggle(), 'valueChange', true);
        expect(toggle()).toHaveProp('value', true);
        expect(selected()).toHaveProp('accessibilityState', { checked: false });
        await fireEvent.press(selected());
        expect(toggle()).toHaveProp('value', true);
        expect(selected()).toHaveProp('accessibilityState', { checked: true });
        const restored = restoreConversationA2UILayout(
          storeConversationA2UILayout(root, answer),
          answer,
        );
        if (!restored)
          throw new Error('Expected the accepted prose layout to restore.');
        await ui.rerender(<ConversationA2UISurface root={restored} />);
        expect(screen.queryByLabelText(localA2UICheckLabel)).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
        for (const text of parts) expect(screen.getByText(text)).toBeVisible();
      } finally {
        await ui.unmount();
      }
      const fresh = await render(<Scene />);
      try {
        expect(screen.getByLabelText(localA2UICheckLabel)).toHaveProp(
          'value',
          false,
        );
        expect(
          screen.getByRole('radio', { name: localA2UIChoices[1].label }),
        ).toHaveProp('accessibilityState', { checked: false });
      } finally {
        await fresh.unmount();
      }
      expect(model.generate).toHaveBeenCalledTimes(1);
    } finally {
      store.dispose();
      motion.mockRestore();
      AppState.currentState = oldState;
    }
  },
);
