import { render, screen, within } from '@testing-library/react-native';
import type { JsonValue } from '@orot/model-runtime';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
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
const formatted = ['방문 1: 서울 · 10분', '방문 2: 부산 · 20분'];
const answer = formatted.join('\n');
const bind = {
  '@call': 'formatString',
  args: { value: '방문 ${@index(offset: 1)}: ${name} · ${duration}' },
};

function objectFrame(text: JsonValue = bind, items = rows): JsonValue {
  return {
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
  };
}

function frame(text?: JsonValue, items?: typeof rows) {
  return JSON.stringify(objectFrame(text, items));
}

function updateItems(value: typeof rows) {
  return JSON.stringify({
    version: '1.0',
    updateDataModel: { surfaceId, path: '/items', value },
  });
}

const cases: readonly {
  label: string;
  frames: readonly JsonValue[];
  accepts: boolean;
}[] = [
  {
    label: 'replacement numbering follows final row order',
    frames: [
      frame(bind, [{ name: '기존', duration: '이전 값' }]),
      updateItems(rows),
    ],
    accepts: true,
  },
  {
    label: 'official object frames mount as the same owned collection',
    frames: [objectFrame()],
    accepts: true,
  },
  {
    label: 'reordered rows cannot replace the accepted answer',
    frames: [frame(bind, [...rows].reverse())],
    accepts: false,
  },
  {
    label: 'offset cannot bind to an existing field',
    frames: [
      frame({
        ...bind,
        args: {
          value: '방문 ${@index(offset: duration)}: ${name} · ${duration}',
        },
      }),
    ],
    accepts: false,
  },
];

test('collection indexes are versioned, scope-local, and stripped from materialized frames', () => {
  const current = ragConversationTask;
  const previous = restoreConversationTask({
    taskType: current.taskType,
    taskVersion: '67',
  });
  if (!previous) throw new Error('Missing version 67.');
  const input = {
    request: '방문 순서를 정리해 주세요.',
    evidence,
    context: [],
  } as Parameters<typeof current.validateResult>[1];
  const original = {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [frame()],
  };
  expect(previous.validateResult(original, input)).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  });
  expect(JSON.stringify(previous.createResultSchema?.(input))).not.toContain(
    '@index(offset: 1)',
  );
  expect(JSON.stringify(current.createResultSchema?.(input))).toContain(
    '@index(offset: 1)',
  );
  const zero = lowerConversationRepeatedChildren(
    [
      frame({
        ...bind,
        args: { value: '방문 ${@index()}: ${name} · ${duration}' },
      }),
    ],
    false,
    true,
    true,
  );
  expect(zero?.[0]).toContain('방문 0: 서울');
  expect(zero?.[0]).not.toMatch(/dataModel|@call|duration/u);
  expect(
    lowerConversationRepeatedChildren(
      [
        frame({
          ...bind,
          args: { value: '방문 ${@index(offset: 1e999)}: ${name}' },
        }),
      ],
      false,
      true,
      true,
    ),
  ).toBeUndefined();
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
          a2uiFrames: [...frames],
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
          if (!parsed) throw new Error('Expected an admitted layout.');
          const layout = storeConversationA2UILayout(parsed, answer);
          expect(layout).toEqual({ version: 2, tree: ['List', 0, 0] });
          expect(restoreConversationA2UILayout(layout, answer)?.component).toBe(
            'List',
          );
          expect(restoreConversationA2UILayout(layout, '')).toBeUndefined();
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
