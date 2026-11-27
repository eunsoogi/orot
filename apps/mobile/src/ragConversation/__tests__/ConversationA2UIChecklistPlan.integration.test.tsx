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
import { runRagConversationTurn } from '../service';
import { ragConversationTask } from '../task';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { syntheticPublicLayoutPlan } from '../testSupport/syntheticPublicLayoutPlan';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';

const prompt = '준비물을 실내와 야외 탭으로 나눠 체크할 수 있게 해 줘.';
const indoor = ['실내', '물병', '수건'];
const outdoor = ['야외', '모자', '방수 가방'];
const lines = (panel: readonly string[]) =>
  [panel[0], ...panel.slice(1).map(label => '☐ ' + label)].join('\n');
const answer = [lines(indoor), lines(outdoor)].join('\n');

function frames(action = false, duplicateText = false): JsonValue {
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
              children: labels.flatMap((_, ix) =>
                duplicateText ? [id + ix, id + 'copy' + ix] : [id + ix],
              ),
            },
            ...(duplicateText
              ? labels.map((label, ix): JsonObject => ({
                  id: id + 'copy' + ix,
                  component: 'Text',
                  text: '☐ ' + label,
                }))
              : []),
            ...labels.map((label, ix): JsonObject => ({
              id: id + ix,
              component: 'CheckBox',
              label,
              value: { '@path': '/local/' + id + ix },
              ...(action && id === 'outdoor' && ix === 0
                ? { action: { event: { name: 'submit' } } }
                : {}),
            })),
          ]),
        ],
      },
    },
  ];
}

test('v61 does not reinterpret an exact unchecked item as a checkbox', () => {
  const task = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '61',
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
    'unchecked fallback item',
  );
});

test.each([
  { name: 'exact', answer, offered: true, action: false },
  { name: 'not offered', answer, offered: false, action: false },
  {
    name: 'duplicate',
    answer: answer.replace('☐ 물병', '☐ 물병\n☐ 물병'),
    offered: true,
    action: false,
  },
  {
    name: 'reordered',
    answer: [lines(outdoor), lines(indoor)].join('\n'),
    offered: true,
    action: false,
  },
  { name: 'action', answer, offered: true, action: true },
  { name: 'duplicate text node', answer, offered: true, action: false },
])(
  'actual Plan ordinary finished reply keeps exact prose and scoped checkbox state: $name',
  async scenario => {
    const local = fixture();
    const plan = syntheticPublicLayoutPlan(
      JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer: scenario.answer,
          ...(scenario.offered
            ? {
                a2uiFrames: frames(
                  scenario.action,
                  scenario.name === 'duplicate text node',
                ),
              }
            : {}),
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
        expect(last?.content).toBe(scenario.answer);
        if (scenario.name !== 'exact') {
          expect(last?.a2uiPresentation).toBeUndefined();
          expect(screen.queryByRole('tab', { name: '실내' })).toBeNull();
          return;
        }
        const root = last?.a2uiPresentation;
        if (root?.component !== 'Tabs')
          throw new Error('Expected owned native tabs');
        expect(storeConversationA2UILayout(root, answer)).toBeUndefined();
        const toggle = () => screen.getByLabelText('물병');
        expect(screen.getAllByText('물병')).toHaveLength(1);
        expect(screen.queryByText('☐ 물병')).toBeNull();
        expect(toggle()).toHaveProp('value', false);
        await fireEvent(toggle(), 'valueChange', true);
        await fireEvent.press(screen.getByRole('tab', { name: '야외' }));
        expect(screen.queryByLabelText('물병')).toBeNull();
        expect(screen.getByLabelText('모자')).toHaveProp('value', false);
        await fireEvent.press(screen.getByRole('tab', { name: '실내' }));
        expect(toggle()).toHaveProp('value', true);
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
  },
);
