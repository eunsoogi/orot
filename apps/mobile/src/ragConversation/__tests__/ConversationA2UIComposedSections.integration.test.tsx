import { render, screen, within } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { lowerConversationRepeatedChildren } from '../conversationA2UIRepeatedChildren';
import { projectConversationA2UISkeleton } from '../conversationA2UISkeleton';
import { createConversationSessions } from '../conversationSessions';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const sections = [
  '요약: 배포 준비부터 살펴봐요.',
  '다음 단계: 검토 의견을 모아요.',
  '그다음: 결과를 팀에 알려요.',
] as const;
const answer = sections.join('\n');
const components = [
  { id: 'root', component: 'Column', children: ['summary', 'follow-up'] },
  {
    id: 'summary',
    component: 'Row',
    children: { path: '/items', componentId: 'summary-body' },
  },
  { id: 'summary-body', component: 'Text', text: { '@path': 'title' } },
  {
    id: 'follow-up',
    component: 'List',
    children: { path: '/secondaryItems', componentId: 'next-card' },
  },
  { id: 'next-card', component: 'Card', child: 'next-body' },
  { id: 'next-body', component: 'Text', text: { '@path': 'title' } },
];

function frame(operation: string, value: object) {
  return JSON.stringify({
    version: '1.0',
    [operation]: { surfaceId: 'orot:response:draft', ...value },
  });
}
function create(overrides = {}) {
  return frame('createSurface', {
    catalogId: conversationA2UICatalog,
    dataModel: {
      items: [{ title: sections[0] }],
      secondaryItems: [{ title: '임시 다음 단계' }],
    },
    components,
    ...overrides,
  });
}
const replacement = frame('updateDataModel', {
  path: '/secondaryItems',
  value: sections.slice(1).map(title => ({ title })),
});
function result(frames: readonly string[]) {
  return {
    type: 'result' as const,
    value: {
      answerKind: 'conversation' as const,
      answer,
      a2uiFrames: [...frames],
    },
    citations: [],
  };
}

test('keeps v37 final and streamed projection isolated from the composed draft', () => {
  const frames = [create(), replacement];
  expect(lowerConversationRepeatedChildren(frames)).toBeUndefined();
  expect(
    projectConversationA2UISkeleton(JSON.stringify(result(frames)), true),
  ).toBeUndefined();
  expect(lowerConversationRepeatedChildren(frames, true)).toHaveLength(1);
  const historical = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '37',
  });
  expect(historical?.taskVersion).toBe('37');
  expect(historical?.projectStreamedLayout).toBe(
    ragConversationTask.projectStreamedLayout,
  );
});

test.each([
  [
    'shared template node',
    create({
      components: components.map(node =>
        node.id === 'next-card' ? { ...node, child: 'summary-body' } : node,
      ),
    }),
    replacement,
  ],
  [
    'cross-array leaf',
    create({
      components: components.map(node =>
        node.id === 'next-body'
          ? { ...node, text: { '@path': '/items/0/title' } }
          : node,
      ),
    }),
    replacement,
  ],
  [
    'wire reference to derived node',
    create({
      components: components.map(node =>
        node.id === 'root'
          ? { ...node, children: ['summary', 'repeat-0-next-card'] }
          : node,
      ),
    }),
    replacement,
  ],
  [
    'foreign update',
    create(),
    frame('updateDataModel', {
      surfaceId: 'different-response',
      path: '/secondaryItems',
      value: [{ title: sections[1] }],
    }),
  ],
  [
    'unknown data array',
    create({
      dataModel: {
        items: [{ title: sections[0] }],
        secondaryItems: [{ title: sections[1] }],
        extra: [],
      },
    }),
    replacement,
  ],
  [
    'child-array subpath',
    create(),
    frame('updateDataModel', {
      path: '/secondaryItems/0',
      value: [{ title: sections[1] }],
    }),
  ],
  ['duplicate replacement', create(), replacement, replacement],
  ['overflow work', create(), replacement, replacement, replacement],
])('rejects %s before final admission', (_description, ...frames) => {
  expect(lowerConversationRepeatedChildren(frames, true)).toBeUndefined();
});

test.each(['accepted layout', 'mismatched order'] as const)(
  'mounts one owned reply and preserves the original prose for %s',
  async mode => {
    const model = fixture();
    const final = result([
      create(),
      mode === 'accepted layout'
        ? replacement
        : frame('updateDataModel', {
            path: '/secondaryItems',
            value: sections
              .slice(1)
              .reverse()
              .map(title => ({ title })),
          }),
    ]);
    model.generate.mockReset().mockResolvedValueOnce(response(final));
    const sessions = createConversationSessions();
    try {
      sessions.setDraft(1, '간단한 요약과 후속 단계를 보여 주세요.');
      await sessions.send(1, (question, previousMessages, signal) =>
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
      const owned = sessions.getSnapshot().sessions[0]!;
      const presentation = owned.messages.at(-1)?.a2uiPresentation;
      const view = await render(
        <ConversationTranscriptMessages
          messages={owned.messages}
          instructions={undefined}
          replyFocus={undefined}
          onLayout={jest.fn()}
          messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
        />,
      );
      const body = within(screen.getByTestId('rag-conversation-answer-body'));
      if (mode === 'accepted layout') {
        expect(presentation?.component).toBe('Column');
        if (presentation?.component !== 'Column')
          throw new Error('Expected a composed column');
        expect(presentation.children.map(node => node.component)).toEqual([
          'Row',
          'List',
        ]);
        for (const paragraph of sections)
          expect(body.getByText(paragraph)).toBeTruthy();
        expect(body.queryByText('임시 다음 단계')).toBeNull();
        const archived = storeConversationA2UILayout(presentation, answer);
        expect(restoreConversationA2UILayout(archived, answer)?.component).toBe(
          'Column',
        );
      } else {
        expect(presentation).toBeUndefined();
        expect(body.getByText(answer)).toBeTruthy();
      }
      await view.unmount();
      expect(model.generate).toHaveBeenCalledTimes(1);
    } finally {
      sessions.dispose();
    }
  },
);
