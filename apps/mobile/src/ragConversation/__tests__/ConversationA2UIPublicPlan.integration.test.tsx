import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, NativeModules } from 'react-native';
import { runDefaultPublicSearch } from '../../aiFeatures/integration/defaultPublicSearch';
import { createPublicWebEvidence } from '../../aiFeatures/integration/publicWebEvidence';
import { publicEvidenceFixture } from '../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';
import { t } from '../../i18n';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { syntheticPublicLayoutPlan } from '../testSupport/syntheticPublicLayoutPlan';
import { fixture } from '../testSupport/conversationEnvelopeFixtures';
import { useConversationPresentationSnapshot } from '../useConversationPresentationSnapshot';

const prompt = '준비물을 실내와 야외의 두 개 탭으로 정리해 줘.';
const intro = '준비물';
const first = ['실내', '물병', '수건', '갈아입을 옷'];
const second = ['야외', '모자', '방수 가방', '휴대용 조명'];
const answer = [intro, ...first, ...second].join('\n');
const disclaimer = t('externalMedicalEvidence.answer.publicWebDisclaimer');
const frames = [
  {
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: 'Column', children: ['intro', 'tabs'] },
        { id: 'intro', component: 'Text', text: intro },
        {
          id: 'tabs',
          component: 'Tabs',
          tabs: [
            { title: first[0], child: 'first' },
            { title: second[0], child: 'second' },
          ],
        },
        ...(
          [
            ['first', first.slice(1)],
            ['second', second.slice(1)],
          ] as const
        ).flatMap(([id, items]) => {
          const children = items.map((_, index) => id + index);
          return [
            { id, component: 'List', children },
            ...items.map((text, index) => ({
              id: children[index],
              component: 'Text',
              text,
            })),
          ];
        }),
      ],
    },
  },
];

const scenarios = [
  'valid',
  'missing frames',
  'wrong order',
  'unknown citation',
] as const;
test.each(scenarios)(
  'stock consented web search and ChatGPT Plan terminal result: %s',
  async mode => {
    const oldPhase = AppState.currentState;
    const oldDiagnostic = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    AppState.currentState = 'active';
    const motion = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const webSetup = publicEvidenceFixture();
    const web = createPublicWebEvidence(webSetup);
    if (!web) throw new Error('Expected stock public evidence tool');
    const search = await runDefaultPublicSearch({
      tool: web.tool,
      operationRunId: 'synthetic-public-a2ui',
      request: prompt,
      signal: webSetup.controller.signal,
    });
    if (search.status !== 'success')
      throw new Error('Expected stock consented synthetic search');
    expect(webSetup.search).toHaveBeenCalledTimes(1);
    expect(webSetup.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        consentScope: expect.objectContaining({ purpose: 'public_web_search' }),
      }),
    );
    const evidence = search.batch.items[0];
    if (!evidence)
      throw new Error('Expected real public-web evidence identity');
    const plan = syntheticPublicLayoutPlan(
      JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'grounded',
          answer:
            mode === 'wrong order'
              ? [intro, ...second, ...first].join('\n')
              : answer,
          ...(mode === 'missing frames' ? {} : { a2uiFrames: frames }),
        },
        citations: [
          mode === 'unknown citation'
            ? 'outside-current-search'
            : evidence.evidenceId,
        ],
      }),
    );
    const local = fixture();
    const store = createConversationSessions();
    function Scene() {
      const snapshot = useConversationPresentationSnapshot(store);
      const session = snapshot.sessions.find(
        item => item.id === snapshot.activeId,
      );
      return (
        <NavigationMotionContext.Provider value>
          <ConversationTranscriptMessages
            messages={session?.messages ?? []}
            instructions={undefined}
            replyFocus={undefined}
            onLayout={jest.fn()}
            messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
          />
        </NavigationMotionContext.Provider>
      );
    }
    try {
      const ui = await render(<Scene />);
      try {
        await act(async () => {
          store.setDraft(1, prompt);
          await store.send(1, (question, previousMessages, signal) =>
            runRagConversationTurn(
              {
                ...local.options,
                question,
                previousMessages,
                publicEvidence: search.batch,
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
        expect(JSON.stringify(plan.requests[0]?.messages)).toContain(
          'a2uiFrames',
        );
        expect(plan.requests[0]).not.toHaveProperty('responseFormat');
        const publicDecisions = report.mock.calls.filter(
          calls =>
            calls[1] === 'conversation_a2ui_public_proposal' ||
            calls[1] === 'conversation_a2ui_public_publication',
        );
        if (mode !== 'unknown citation') {
          expect(publicDecisions).toEqual([
            [
              'rag',
              'conversation_a2ui_public_proposal',
              mode === 'valid'
                ? 'a2ui_admitted'
                : mode === 'missing frames'
                  ? 'a2ui_no_frames'
                  : 'a2ui_invalid_frames',
            ],
            [
              'rag',
              'conversation_a2ui_public_publication',
              mode === 'valid' ? 'a2ui_published' : 'a2ui_no_proposal',
            ],
          ]);
        } else {
          expect(
            publicDecisions.some(call => call[2] === 'a2ui_published'),
          ).toBe(false);
        }
        const last = store.getSnapshot().sessions[0]?.messages.at(-1);
        if (mode === 'unknown citation') {
          expect(last?.citations ?? []).toEqual([]);
          expect(last?.a2uiPresentation).toBeUndefined();
          return;
        }
        expect(last?.citations?.map(item => item.evidenceId)).toEqual([
          evidence.evidenceId,
        ]);
        expect(last?.content).toContain(disclaimer);
        const receipt = report.mock.calls.find(
          call => call[1] === 'conversation_a2ui_plan_envelope',
        );
        expect(receipt?.[2]).toBe(
          mode === 'missing frames' ? 'absent' : 'present',
        );
        if (mode !== 'valid') {
          expect(last?.a2uiPresentation).toBeUndefined();
          expect(screen.queryByRole('tab', { name: '실내' })).toBeNull();
          return;
        }
        expect(last?.a2uiPresentation).toBeDefined();
        expect(screen.getByRole('tab', { name: '실내' })).toBeVisible();
        for (const item of first.slice(1))
          expect(screen.getByText(item)).toBeVisible();
        expect(screen.queryByText('모자')).toBeNull();
        expect(screen.getByText(disclaimer)).toBeVisible();
        await fireEvent.press(screen.getByRole('tab', { name: '야외' }));
        for (const item of second.slice(1))
          expect(screen.getByText(item)).toBeVisible();
        expect(screen.queryByText('물병')).toBeNull();
        expect(screen.getByText(disclaimer)).toBeVisible();
        expect(plan.requests).toHaveLength(1);
      } finally {
        await ui.unmount();
      }
    } finally {
      store.dispose();
      motion.mockRestore();
      AppState.currentState = oldPhase;
      NativeModules.OrotProviderDiagnostics = oldDiagnostic;
    }
  },
);
