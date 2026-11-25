import { render, screen, within } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { projectFinalRepeatedChildren } from '../conversationA2UIRepeatedChildren';
import { createConversationSessions } from '../conversationSessions';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const emptyEvidence = { items: [], coverage: [], conflicts: [] };
const draft = 'orot:response:draft';
const first = { title: '사과', detail: '사과 설명' };
const second = { title: '배', detail: '배 설명' };
const paragraphs = [first.title, first.detail, second.title, second.detail];
const answer = paragraphs.join('\n');

function frame(op: string, payload: object, surfaceId = draft) {
  return JSON.stringify({ version: '1.0', [op]: { surfaceId, ...payload } });
}

function create(kind: 'Row' | 'Column' | 'List', overrides: object = {}) {
  return frame('createSurface', {
    catalogId: conversationA2UICatalog,
    dataModel: { items: [{ title: '이전 제목', detail: '이전 설명' }] },
    components: [
      {
        id: 'root',
        component: kind,
        children: { path: '/items', componentId: 'card' },
      },
      { id: 'card', component: 'Card', child: 'row' },
      { id: 'row', component: 'Row', children: ['title', 'detail'] },
      { id: 'title', component: 'Text', text: { '@path': 'title' } },
      { id: 'detail', component: 'Text', text: { '@path': 'detail' } },
    ],
    ...overrides,
  });
}
const data = frame('updateDataModel', {
  path: '/items',
  value: [first, second],
});
const wrong = frame('updateDataModel', {
  path: '/items',
  value: [second, first],
});

test.each([
  [
    'foreign operation',
    frame(
      'updateDataModel',
      { path: '/items', value: [first] },
      'orot:other:turn',
    ),
  ],
  [
    'subpath write',
    frame('updateDataModel', { path: '/items/0', value: first }),
  ],
  [
    'hidden fields',
    frame('updateDataModel', {
      path: '/items',
      value: [{ ...first, other: 'extra' }],
    }),
  ],
  [
    'overflow rows',
    frame('updateDataModel', {
      path: '/items',
      value: Array.from({ length: 13 }, () => first),
    }),
  ],
] as const)(
  'denies %s without materializing a repeated layout',
  (_label, bad) => {
    expect(
      projectFinalRepeatedChildren([create('Column'), bad]),
    ).toBeUndefined();
  },
);
test.each(['title', 'repeat-0-title'])(
  'does not permit an ordinary card to reference template-owned id %s',
  ref => {
    const carrier: unknown = JSON.parse(create('Column'));
    const createFrame = carrier as {
      createSurface: { components: Array<Readonly<Record<string, unknown>>> };
    };
    createFrame.createSurface.components.push({
      id: 'foreign-card',
      component: 'Card',
      child: ref,
    });
    expect(
      projectFinalRepeatedChildren([JSON.stringify(createFrame), data]),
    ).toBeUndefined();
  },
);

test('denies data synchronization and an extra frame', () => {
  expect(
    projectFinalRepeatedChildren([
      create('Row', { sendDataModel: true }),
      data,
    ]),
  ).toBeUndefined();
  expect(
    projectFinalRepeatedChildren([create('List'), data, data]),
  ).toBeUndefined();
});

test.each([
  {
    label: 'row',
    createFrame: create('Row'),
    component: 'Row',
    update: data,
    accepts: true,
  },
  {
    label: 'column',
    createFrame: create('Column'),
    component: 'Column',
    update: data,
    accepts: true,
  },
  {
    label: 'list',
    createFrame: create('List'),
    component: 'List',
    update: data,
    accepts: true,
  },
  {
    label: 'mismatched order',
    createFrame: create('Column'),
    component: 'Column',
    update: wrong,
    accepts: false,
  },
])(
  'mounts only accepted ordered paragraphs for $label',
  async ({ createFrame, update, accepts, component }) => {
    const model = fixture();
    model.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer,
          a2uiFrames: [createFrame, update],
        },
        citations: [],
      }),
    );
    const sessions = createConversationSessions();
    try {
      sessions.setDraft(1, '두 항목을 같은 구조에 표시해 주세요.');
      await sessions.send(1, (question, previousMessages, signal) =>
        runRagConversationTurn(
          {
            ...model.options,
            question,
            previousMessages,
            loadCurrentEvidence: async () => ({
              batch: emptyEvidence,
              chunks: [],
            }),
          },
          { signal },
        ),
      );
      const session = sessions.getSnapshot().sessions[0]!;
      const presentation = session.messages.at(-1)?.a2uiPresentation;
      const mounted = await render(
        <ConversationTranscriptMessages
          messages={session.messages}
          instructions={undefined}
          replyFocus={undefined}
          onLayout={jest.fn()}
          messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
        />,
      );
      const frameBody = within(
        screen.getByTestId('rag-conversation-answer-body'),
      );
      if (!accepts) {
        expect(presentation).toBeUndefined();
        expect(frameBody.getByText(answer)).toBeTruthy();
      } else {
        expect(presentation?.component).toBe(component);
        for (const paragraph of paragraphs)
          expect(frameBody.getByText(paragraph).props.allowFontScaling).toBe(
            true,
          );
        expect(frameBody.queryByText('이전 제목')).toBeNull();
        expect(frameBody.queryAllByRole('button')).toHaveLength(0);
        const archived = storeConversationA2UILayout(presentation!, answer);
        const restored = restoreConversationA2UILayout(archived, answer);
        if (!restored) throw new Error('Expected an accepted archive layout.');
        await mounted.rerender(<ConversationA2UISurface root={restored} />);
        for (const paragraph of paragraphs)
          expect(screen.getByText(paragraph).props.allowFontScaling).toBe(true);
      }
      await mounted.unmount();
      expect(model.generate).toHaveBeenCalledTimes(1);
    } finally {
      sessions.dispose();
    }
  },
);
