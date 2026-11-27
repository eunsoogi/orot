import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { conversationA2UICardWeight } from '../conversationA2UICardWeightTask';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 520,
    height: 844,
    scale: 3,
    fontScale: mockFontScale,
  }),
}));

const parts = [
  '요약 내용을 읽어요.',
  '준비물을 확인해요.',
  '다음 순서를 봐요.',
];
const answer = parts.join('\n');
const input = {
  request: '요약 카드와 두 가지 세부 항목을 나란히 보여 주세요.',
  context: [],
  evidence: { items: [], coverage: [], conflicts: [] },
} as TaskResponderInput;
function proposal(
  weight: JsonValue = 2,
  separate = false,
  data = false,
): { answerKind: string; answer: string; a2uiFrames: JsonValue[] } {
  return {
    answerKind: 'conversation',
    answer,
    a2uiFrames: [
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'orot:response:draft',
          catalogId: conversationA2UICatalog,
          ...(data ? { dataModel: {} } : {}),
          components: [
            {
              id: 'root',
              component: separate ? 'Column' : 'Row',
              children: separate ? ['left', 'right'] : ['summary', 'details'],
            },
            ...(separate
              ? [
                  { id: 'left', component: 'Row', children: ['summary'] },
                  { id: 'right', component: 'Row', children: ['details'] },
                ]
              : []),
            { id: 'summary', component: 'Card', child: 'line0', weight: 1 },
            {
              id: 'details',
              component: 'Column',
              children: ['line1', 'line2'],
              weight,
            },
            ...parts.map((text, index) => ({
              id: 'line' + index,
              component: 'Text',
              text,
            })),
          ],
        },
      },
    ],
  };
}
const plain = {
  status: 'valid',
  value: { answerKind: 'conversation', answer },
};

test('the ordinary reply mounts one responsive card plus wider grouped details', async () => {
  const current = ragConversationTask.validateResult(proposal(), input);
  if (current.status !== 'valid' || !current.value.a2uiPresentation)
    throw new Error('Expected a mixed weighted comparison');
  const root = current.value.a2uiPresentation;
  if (root.component !== 'Row') throw new Error('Expected a row');
  expect(conversationA2UICardWeight(root.children[0]!)).toBeUndefined();
  const ui = await render(<ConversationA2UISurface root={root} />);
  const row = () => screen.getByTestId('conversation-a2ui-row');
  const width = (value: number) =>
    fireEvent(row(), 'layout', { nativeEvent: { layout: { width: value } } });
  const grows = () =>
    row().children.map(child =>
      typeof child === 'string'
        ? undefined
        : StyleSheet.flatten(child.props.style)?.flexGrow,
    );
  try {
    await width(320);
    expect(grows()).toEqual([undefined, undefined]);
    await width(520);
    expect(grows()).toEqual([1, 2]);
    for (const text of parts) expect(screen.getByText(text)).toBeVisible();
    mockFontScale = 1.5;
    await ui.rerender(<ConversationA2UISurface root={root} />);
    expect(grows()).toEqual([undefined, undefined]);
    const stored = storeConversationA2UILayout(root, answer);
    const restored = restoreConversationA2UILayout(stored, answer);
    if (restored?.component !== 'Row')
      throw new Error('Expected the existing archive grouping');
    expect(restored.children.map(node => node.component)).toEqual([
      'Card',
      'Column',
    ]);
    expect(restoreConversationA2UILayout(stored, parts[0]!)).toBeUndefined();
    mockFontScale = 1;
    await ui.rerender(<ConversationA2UISurface root={restored} />);
    await width(520);
    expect(grows()).not.toEqual([1, 2]);
    for (const text of parts) expect(screen.getByText(text)).toBeVisible();
  } finally {
    mockFontScale = 1;
    await ui.unmount();
  }
});

test('historic v58 rejects the mixed weights without changing ordinary prose', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '58',
  });
  expect(old?.validateResult(proposal(), input)).toEqual(plain);
  expect(JSON.stringify(old?.createResultSchema?.(input, true))).not.toContain(
    'mix weighted',
  );
  expect(
    JSON.stringify(ragConversationTask.createResultSchema?.(input, true)),
  ).toContain('mix weighted');
});

test.each([
  proposal(0),
  proposal({ '@path': '/form/width' }),
  proposal(2, true),
  proposal(2, false, true),
])(
  'rejects malformed weights, cross-row mixtures and dynamic model data',
  value =>
    expect(ragConversationTask.validateResult(value, input)).toEqual(plain),
);

test('incorrect accepted answer order cannot display the projected Row', () => {
  const changed = [...parts].reverse().join('\n');
  expect(
    ragConversationTask.validateResult(
      { ...proposal(), answer: changed },
      input,
    ),
  ).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer: changed },
  });
});
