import type { JsonObject, JsonValue } from '@orot/model-runtime';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import { storeConversationA2UILayout } from '../conversationA2UIArchive';
import {
  ConversationA2UILocalDraftOwner,
  useConversationA2UILocalDraftOwner,
} from '../conversationA2UILocalDraftOwner';
import { createConversationSessions } from '../conversationSessions';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { runRagConversationTurn } from '../service';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { syntheticPublicLayoutPlan } from '../testSupport/syntheticPublicLayoutPlan';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';

const prompt =
  '실내외 준비물 탭에 체크리스트와 준비 메모, 이동 선택지를 같이 보여 줘.';
const indoor = ['실내', '물병', '수건'];
const outdoor = ['야외', '모자', '방수 가방'];
const lines = (panel: readonly string[]) =>
  [panel[0], ...panel.slice(1).map(label => '☐ ' + label)].join('\n');
const answer = [lines(indoor), lines(outdoor)].join('\n');

function frames(): JsonValue {
  return [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'orot:response:draft',
        catalogId: conversationA2UICatalog,
        components: [
          {
            id: 'root',
            component: 'Tabs',
            tabs: [
              { title: indoor[0]!, child: 'indoor' },
              { title: outdoor[0]!, child: 'outdoor' },
            ],
          },
          ...(
            [
              ['indoor', indoor.slice(1)],
              ['outdoor', outdoor.slice(1)],
            ] as const
          ).flatMap(([id, labels]): JsonObject[] => [
            {
              id,
              component: 'Column',
              children: [...labels.map((_, ix) => id + ix), id + 'control'],
            },
            id === 'indoor'
              ? {
                  id: id + 'control',
                  component: 'TextField',
                  variant: 'longText',
                  label: '준비 메모',
                  value: { '@path': '/local/notes' },
                }
              : {
                  id: id + 'control',
                  component: 'ChoicePicker',
                  label: '이동 방법',
                  variant: 'mutuallyExclusive',
                  options: [
                    { label: '걷기', value: 'walk' },
                    { label: '버스', value: 'bus' },
                  ],
                  value: { '@path': '/local/travel' },
                },
            ...labels.map((label, ix): JsonObject => ({
              id: id + ix,
              component: 'CheckBox',
              label,
              value: { '@path': '/local/' + id + ix },
            })),
          ]),
        ],
      },
    },
  ];
}

test('ordinary Plan composes exact checklist items with a temporary note and choice', async () => {
  const local = fixture();
  const plan = syntheticPublicLayoutPlan(
    JSON.stringify({
      type: 'result',
      value: {
        answerKind: 'conversation',
        answer,
        a2uiFrames: frames(),
      },
      citations: [],
    }),
  );
  const previousPhase = AppState.currentState;
  AppState.currentState = 'active';
  const motion = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
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
            messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
          />
        </ConversationA2UILocalDraftOwner.Provider>
      </NavigationMotionContext.Provider>
    );
  }
  try {
    const view = await render(<Scene />);
    try {
      await act(async () => {
        store.setDraft(1, prompt);
        await store.send(1, (question, previousMessages, signal) =>
          runRagConversationTurn(
            {
              ...local.options,
              question,
              previousMessages,
              loadCurrentEvidence: async () => ({
                batch: { items: [], coverage: [], conflicts: [] },
                chunks: [],
              }),
              workflow: {
                ...local.options.workflow,
                provider: plan.provider,
                execution: {
                  ...local.options.workflow.execution,
                  providerId: plan.provider.id,
                  modelId: plan.provider.id,
                },
              },
            },
            { signal },
          ),
        );
      });
      expect(local.generate).not.toHaveBeenCalled();
      expect(plan.requests).toHaveLength(1);
      expect(JSON.stringify(plan.requests[0]?.messages)).toContain(
        'unchecked fallback item',
      );
      const last = store.getSnapshot().sessions[0]?.messages.at(-1);
      expect(last?.content).toBe(answer);
      const root = last?.a2uiPresentation;
      if (root?.component !== 'Tabs')
        throw new Error('Expected owned native tabs');
      expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
      const toggle = () => screen.getByLabelText('물병');
      expect(screen.getAllByText('물병')).toHaveLength(1);
      expect(screen.queryByText('☐ 물병')).toBeNull();
      expect(toggle()).toHaveProp('value', false);
      const notes = () => screen.getByLabelText('준비 메모');
      expect(notes()).toHaveProp('multiline', true);
      await fireEvent.changeText(notes(), '추가 준비');
      expect(notes()).toHaveProp('value', '추가 준비');
      await fireEvent(toggle(), 'valueChange', true);
      await fireEvent.press(screen.getByRole('tab', { name: '야외' }));
      expect(screen.queryByLabelText('물병')).toBeNull();
      expect(screen.getByLabelText('모자')).toHaveProp('value', false);
      const bus = screen.getByRole('radio', { name: '버스' });
      await fireEvent.press(bus);
      expect(bus).toHaveProp('accessibilityState', { checked: true });
      await fireEvent.press(screen.getByRole('tab', { name: '실내' }));
      expect(toggle()).toHaveProp('value', true);
      expect(notes()).toHaveProp('value', '');
      expect(last?.content).toBe(answer);
      expect(plan.requests).toHaveLength(1);
    } finally {
      await view.unmount();
    }
  } finally {
    store.dispose();
    motion.mockRestore();
    AppState.currentState = previousPhase;
  }
});

test('historic v62 does not admit this mixed form or advertise it', () => {
  const task = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '62',
  });
  const input = {
    request: prompt,
    context: [],
    evidence: { items: [], coverage: [], conflicts: [] },
  };
  expect(
    task?.validateResult(
      { answerKind: 'conversation', answer, a2uiFrames: frames() },
      input,
    ),
  ).toEqual({ status: 'valid', value: { answerKind: 'conversation', answer } });
  expect(JSON.stringify(task?.createResultSchema?.(input, true))).not.toContain(
    'alongside checklist items',
  );
});
