import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { conversationGeneratedTools } from '../../aiFeatures/integration/conversationGeneratedTools';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { publicSearchNotice } from '../../aiFeatures/integration/defaultPublicSearch';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { finishConversationWorkflow } from '../../aiFeatures/integration/finishConversationWorkflow';
import { t } from '../../i18n';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  appendConversationAppNotice,
  conversationA2UIAppNotices,
} from '../conversationA2UIAppNotices';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { setup } from '../testSupport/continuousSessionFixture';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { syntheticPublicLayoutPlan } from '../testSupport/syntheticPublicLayoutPlan';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';

const answer = '실내\n물병\n야외\n모자';
const previousOmitted = t('ragConversation.conversation.priorDialogueOmitted');
const unavailable = publicSearchNotice('unavailable');
const frames = [
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
            { title: '실내', child: 'first' },
            { title: '야외', child: 'second' },
          ],
        },
        { id: 'first', component: 'Text', text: '물병' },
        { id: 'second', component: 'Text', text: '모자' },
      ],
    },
  },
];

test('accepted Plan layout keeps both exact app notices visible after finalization and tab changes', async () => {
  const f = await setup();
  const model = fixture();
  const motion = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const plan = syntheticPublicLayoutPlan(
    JSON.stringify({
      type: 'result',
      value: { answerKind: 'conversation', answer, a2uiFrames: frames },
      citations: [],
    }),
  );
  const registry = new LocalEvidenceReferenceRegistry();
  const store = createConversationSessions({ retention: f.options.retention });
  function Scene() {
    const snapshot = useConversationPresentationSnapshot(store);
    return (
      <NavigationMotionContext.Provider value>
        <ConversationTranscriptMessages
          messages={snapshot.sessions[0]?.messages ?? []}
          instructions={undefined}
          replyFocus={undefined}
          onLayout={jest.fn()}
          messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
        />
      </NavigationMotionContext.Provider>
    );
  }
  const view = await render(<Scene />);
  try {
    await act(async () => {
      store.setDraft(1, '준비물을 두 가지 상황으로 나눠 알려 줘.');
      await store.send(
        1,
        async (question, previousMessages, signal, observer) => {
          const owned = signal ?? new AbortController().signal;
          const retention = createConversationRetentionBridge({
            observer,
            registry,
            question,
            providerId: plan.provider.id,
            modelId: plan.provider.id,
            signal: owned,
          });
          const outcome = await runRagConversationTurn(
            {
              ...model.options,
              question,
              previousMessages,
              loadCurrentEvidence: async () => ({
                batch: { items: [], coverage: [], conflicts: [] },
                chunks: [],
              }),
              onValidatedEvidence: retention.onValidatedEvidence,
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
            { signal: owned },
          );
          return finishConversationWorkflow({
            outcome,
            observer,
            priorDialogueOmitted: true,
            generated: conversationGeneratedTools(
              localData([]).data,
              registry,
              observer,
            ),
            localRetrievalFailed: () => false,
            historyIsCurrent: async () => true,
            publicSearch: { status: 'unavailable' },
            retention,
            signal: owned,
          });
        },
      );
    });
    expect(plan.requests).toHaveLength(1);
    const last = store.getSnapshot().sessions[0]?.messages.at(-1);
    expect(last?.content).toBe(
      [answer, previousOmitted, unavailable].join('\n\n'),
    );
    expect(last?.a2uiPresentation).toBeDefined();
    const completed = await f.storage.listCompletionIdentities();
    expect(completed).toHaveLength(1);
    expect(screen.getByRole('tab', { name: '실내' })).toBeVisible();
    for (const notice of [previousOmitted, unavailable])
      expect(screen.getByText(notice)).toBeVisible();
    await fireEvent.press(screen.getByRole('tab', { name: '야외' }));
    expect(screen.getByText('모자')).toBeVisible();
    for (const notice of [previousOmitted, unavailable])
      expect(screen.getAllByText(notice)).toHaveLength(1);
  } finally {
    await view.unmount();
    store.dispose();
    f.store.dispose();
    motion.mockRestore();
    f.close();
  }
});

test('supplements require the exact live root and final answer bytes', () => {
  const root = {
    id: 'root',
    component: 'Text',
    variant: 'body',
    text: answer,
  } as const;
  const plain = { status: 'answer', answer, citations: [] } as const;
  const original = { ...plain, a2uiPresentation: root };
  const finished = appendConversationAppNotice(original, unavailable);
  expect(finished.a2uiPresentation).toBe(root);
  expect(conversationA2UIAppNotices(root, finished.answer)).toEqual([
    unavailable,
  ]);
  expect(conversationA2UIAppNotices(root, answer)).toBeUndefined();
  expect(conversationA2UIAppNotices({ ...root }, finished.answer)).toEqual([]);
  expect(
    appendConversationAppNotice(original, previousOmitted).a2uiPresentation,
  ).toBeUndefined();
  expect(appendConversationAppNotice(plain, unavailable)).toEqual({
    ...plain,
    answer: [answer, unavailable].join('\n\n'),
  });
});
