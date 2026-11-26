import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  localA2UICheckPath,
  localA2UIChoicePath,
} from '../conversationA2UILocalDraft';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../conversationA2UILocalDraftOwner';
import { createConversationSessions } from '../conversationSessions';
import { restoreConversationTask } from '../conversationTaskVersions';
import { runRagConversationTurn } from '../service';
import { ragConversationTask } from '../task';
import {
  frame,
  seedCheck,
  seedChoice,
} from '../testSupport/a2uiLocalFormFixtures';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';

const parts = [
  '물을 마시고 하루를 시작해요.',
  '차를 우리고 가방을 챙겨요.',
  '아침 준비에 맞는 항목을 골라요.',
];
const answer = parts.join('\n\n');
const prompt =
  '가상 아침 준비를 설명하고 준비 완료 체크박스와 물 또는 차 선택지를 보여줘.';
function proposal(checkLabel = '준비 완료', optionValue = 'second') {
  const children = parts.map((_, i) => 'part' + String(i));
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      frame('createSurface', {
        catalogId: conversationA2UICatalog,
        components: [
          { id: 'root', component: 'Column', children },
          ...parts.map((text, i) => ({
            id: children[i],
            component: 'Text',
            text,
          })),
        ],
      }),
      seedCheck,
      seedChoice,
      frame('updateComponents', {
        components: [
          {
            id: 'root',
            component: 'Column',
            children: [...children, 'check', 'choice'],
          },
          {
            id: 'check',
            component: 'CheckBox',
            label: checkLabel,
            value: { '@path': localA2UICheckPath },
          },
          {
            id: 'choice',
            component: 'ChoicePicker',
            label: '마실 것',
            variant: 'mutuallyExclusive',
            options: [
              { label: '물', value: 'first' },
              { label: '차', value: optionValue },
            ],
            value: { '@path': localA2UIChoicePath },
          },
        ],
      }),
    ],
  };
}
const input = {
  request: prompt,
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as Parameters<typeof ragConversationTask.validateResult>[1];

test.each(['42', '43'])(
  'v%s keeps its historic fallback for composed labels',
  version => {
    const historical = restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion: version,
    });
    expect(historical?.validateResult(proposal(), input)).toEqual({
      status: 'valid',
      value: { answerKind: 'conversation', answer },
    });
  },
);

test.each([
  proposal('https://example.com'),
  proposal('준비\u202E완료'),
  proposal('준비 완료', 'send'),
  { ...proposal(), answer: parts.slice(0, 2).join('\n\n') },
])('does not admit controls with invalid labels, values or prose', value => {
  expect(ragConversationTask.validateResult(value, input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer: value.answer },
  });
});

test('the ordinary request mounts both requested local controls even with a third prose part', async () => {
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
      value: proposal(),
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
        store.setDraft(1, prompt);
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
      const toggle = () => screen.getByLabelText('준비 완료');
      const tea = () => screen.getByRole('radio', { name: '차' });
      expect(screen.getByText('마실 것')).toBeVisible();
      await fireEvent.press(tea());
      await fireEvent(toggle(), 'valueChange', true);
      expect(toggle()).toHaveProp('value', true);
      expect(tea()).toHaveProp('accessibilityState', { checked: true });
      for (const text of parts) expect(screen.getByText(text)).toBeVisible();
      expect(model.generate).toHaveBeenCalledTimes(1);
    } finally {
      await ui.unmount();
    }
  } finally {
    store.dispose();
    motion.mockRestore();
    AppState.currentState = oldState;
  }
});
