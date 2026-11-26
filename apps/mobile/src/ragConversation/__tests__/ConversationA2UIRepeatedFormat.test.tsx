import { render, screen, within } from '@testing-library/react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import { lowerConversationRepeatedChildren } from '../conversationA2UIRepeatedChildren';
import { createConversationSessions } from '../conversationSessions';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';
import { runRagConversationTurn } from '../service';
import { fixture, response } from '../testSupport/conversationEnvelopeFixtures';

const evidence = { items: [], coverage: [], conflicts: [] };
const surfaceId = 'orot:response:draft';
const rows = [
  { name: '서울', duration: '10분' },
  { name: '부산', duration: '20분' },
];
const formatted = ['서울 · 10분', '부산 · 20분'];
const answer = formatted.join('\n');
const bind = {
  '@call': 'formatString',
  args: { value: '${name} · ${duration}' },
};

function frame(text: unknown = bind, items: readonly object[] = rows) {
  return JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: conversationA2UICatalog,
      dataModel: { items },
      components: [
        {
          id: 'root',
          component: 'List',
          children: { path: '/items', componentId: 'line' },
        },
        { id: 'line', component: 'Text', text },
      ],
    },
  });
}

test.each([
  ['other function', { ...bind, '@call': 'openUrl' }],
  ['absolute path', { ...bind, args: { value: '${/items/0/name}' } }],
  ['nested call', { ...bind, args: { value: '${formatNumber(value:1)}' } }],
  [
    'hidden second expression',
    { ...bind, args: { value: '${name} ${../../secret}' } },
  ],
  ['extra arguments', { ...bind, args: { ...bind.args, other: 'injection' } }],
  ['escape', { ...bind, args: { value: '\\${name}' } }],
])('rejects unsupported formatter input: %s', (_label, binding) => {
  expect(
    lowerConversationRepeatedChildren([frame(binding)], false, true),
  ).toBeUndefined();
});

test('does not enable functions in historical repeated projection or serialize model fields', () => {
  expect(lowerConversationRepeatedChildren([frame()])).toBeUndefined();
  expect(lowerConversationRepeatedChildren([frame()], true)).toBeUndefined();
  expect(
    lowerConversationRepeatedChildren(
      [frame(bind, [{ ...rows[0], hidden: 'extra' }])],
      false,
      true,
    ),
  ).toBeUndefined();
  const next = lowerConversationRepeatedChildren([frame()], false, true);
  expect(next).toHaveLength(1);
  expect(next?.[0]).toContain(formatted[0]);
  expect(next?.[0]).not.toMatch(/dataModel|@call|duration/u);
});

function literalFrame() {
  return JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: 'List', children: ['first', 'second'] },
        { id: 'first', component: 'Text', text: formatted[0] },
        { id: 'second', component: 'Text', text: formatted[1] },
      ],
    },
  });
}

function updateItems(value: typeof rows) {
  return JSON.stringify({
    version: '1.0',
    updateDataModel: { surfaceId, path: '/items', value },
  });
}

const cases = [
  { label: 'literal static Text', frames: [literalFrame()], accepts: true },
  {
    label: 'original direct field',
    frames: [
      frame(
        { '@path': 'line' },
        formatted.map(line => ({ line })),
      ),
    ],
    accepts: true,
  },
  {
    label: 'local formatString with whole-array update',
    frames: [
      frame(bind, [{ name: '기존', duration: '이전 값' }]),
      updateItems(rows),
    ],
    accepts: true,
  },
  {
    label: 'mismatched order',
    frames: [frame(bind, [...rows].reverse())],
    accepts: false,
  },
];

test('restores v40 without enabling the new function branch', () => {
  const previous = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '40',
  });
  if (!previous) throw new Error('Expected historical Conversation v40.');
  const input = { request: '표시해 줘.', evidence, context: [] } as Parameters<
    typeof previous.validateResult
  >[1];
  for (const fixtureCase of cases.slice(0, 2)) {
    const value = {
      answerKind: 'conversation',
      answer,
      a2uiFrames: fixtureCase.frames,
    };
    expect(previous.validateResult(value, input)).toEqual(
      ragConversationTask.validateResult(value, input),
    );
  }
  const value = { answerKind: 'conversation', answer, a2uiFrames: [frame()] };
  expect(previous.validateResult(value, input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
});

test.each(cases)(
  'mounts only exact accepted prose through the ordinary workflow: $label',
  async ({ frames, accepts }) => {
    const model = fixture();
    model.generate.mockReset().mockResolvedValueOnce(
      response({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer,
          a2uiFrames: frames,
        },
        citations: [],
      }),
    );
    const sessions = createConversationSessions();
    try {
      sessions.setDraft(1, '두 도시의 소요 시간을 같은 구조로 보여 주세요.');
      await sessions.send(1, (question, previousMessages, signal) =>
        runRagConversationTurn(
          {
            ...model.options,
            question,
            previousMessages,
            loadCurrentEvidence: async () => ({ batch: evidence, chunks: [] }),
          },
          { signal },
        ),
      );
      const session = sessions.getSnapshot().sessions[0]!;
      const parsed = session.messages.at(-1)?.a2uiPresentation;
      const ui = await render(
        <NavigationMotionContext.Provider value>
          <ConversationTranscriptMessages
            messages={session.messages}
            instructions={undefined}
            replyFocus={undefined}
            onLayout={jest.fn()}
            messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
          />
        </NavigationMotionContext.Provider>,
      );
      try {
        const answerBody = screen.getByTestId('rag-conversation-answer-body');
        const body = within(answerBody);
        if (accepts) {
          expect(parsed?.component).toBe('List');
          for (const line of formatted)
            expect(body.getByText(line)).toBeVisible();
          expect(body.queryAllByRole('button')).toHaveLength(0);
        } else {
          expect(parsed).toBeUndefined();
          expect(answerBody).toBeVisible();
          expect(answerBody).toHaveTextContent(answer, {
            exact: true,
            normalizer: text => text,
          });
        }
        expect(model.generate).toHaveBeenCalledTimes(1);
      } finally {
        await ui.unmount();
      }
    } finally {
      sessions.dispose();
    }
  },
);
