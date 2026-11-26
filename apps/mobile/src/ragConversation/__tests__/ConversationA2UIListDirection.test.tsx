import { StyleSheet } from 'react-native';
import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import { fireEvent, render } from '@testing-library/react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';

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

const answer = '요약\n세부 사항';
const frames = (
  direction: unknown = 'horizontal',
  component = 'List',
  align?: unknown,
) => [
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: 'orot:response:draft',
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: 'Card', child: 'list' },
        {
          id: 'list',
          component,
          direction,
          ...(align !== undefined ? { align } : {}),
          children: ['first', align === undefined ? 'details' : 'detail-card'],
        },
        { id: 'first', component: 'Text', text: '요약' },
        { id: 'details', component: 'Text', text: '세부 사항' },
        ...(align !== undefined
          ? [{ id: 'detail-card', component: 'Card', child: 'details' }]
          : []),
      ],
    },
  }),
];
const accept = (framesToVerify: string[]) =>
  acceptConversationA2UIFrameSequence(
    framesToVerify,
    answer,
    true,
    true,
    true,
    true,
  );

test('a valid composed horizontal list reflows within its owning mounted bubble', async () => {
  mockFontScale = 1;
  const root = accept(frames());
  expect(root).toBeDefined();
  const ui = await render(<ConversationA2UISurface root={root!} />);
  const width = (value: number) =>
    fireEvent(ui.getByTestId('conversation-a2ui-list-layout'), 'layout', {
      nativeEvent: { layout: { width: value } },
    });
  expect(ui.getByTestId('conversation-a2ui-list-stack')).toBeTruthy();
  await width(500);
  expect(ui.getByTestId('conversation-a2ui-list-strip')).toBeTruthy();
  await width(340);
  expect(ui.getByTestId('conversation-a2ui-list-stack')).toBeTruthy();
  await width(500);
  mockFontScale = 2;
  await ui.rerender(<ConversationA2UISurface root={root!} />);
  expect(ui.getByTestId('conversation-a2ui-list-stack')).toBeTruthy();
  expect(
    ui.getAllByText(/요약|세부 사항/u).map(node => node.props.children),
  ).toEqual(['요약', '세부 사항']);
});

test('direction remains literal, owned, and round-trips only a sanitized v6 arrangement', () => {
  expect(
    acceptConversationA2UIFrameSequence(frames(), answer, true, true, true),
  ).toBeUndefined();
  for (const value of ['diagonal', null, { '@path': '/direction' }])
    expect(accept(frames(value))).toBeUndefined();
  expect(accept(frames('horizontal', 'Row'))).toBeUndefined();
  expect(accept(frames('vertical'))).toMatchObject({
    children: [{ component: 'List' }],
  });
  const archive = storeConversationA2UILayout(accept(frames())!, answer);
  expect(archive).toEqual({
    version: 6,
    tree: ['Card', ['HorizontalList', 0, 0]],
  });
  expect(restoreConversationA2UILayout(archive, answer)).toMatchObject({
    children: [
      {
        component: 'List',
        direction: 'horizontal',
        children: [{ text: '요약' }, { text: '세부 사항' }],
      },
    ],
  });
  expect(
    restoreConversationA2UILayout({ version: 5, tree: archive?.tree }, answer),
  ).toBeUndefined();
});

test('a model-authored horizontal List aligns mixed-height items without changing its compact reading order', async () => {
  const input = {
    request: '두 항목을 보기 좋게 보여 주세요.',
    context: [],
    evidence: { items: [], coverage: [], conflicts: [] },
  } as Parameters<typeof ragConversationTask.validateResult>[1];
  const evidenceFree = (align: unknown) => ({
    answerKind: 'conversation',
    answer,
    a2uiFrames: frames('horizontal', 'List', align),
  });
  const accepted = ragConversationTask.validateResult(
    evidenceFree('end'),
    input,
  );
  if (accepted.status !== 'valid' || !accepted.value.a2uiPresentation)
    throw new Error('Expected valid Basic Catalog horizontal alignment');
  const root = accepted.value.a2uiPresentation;
  mockFontScale = 1;
  const ui = await render(<ConversationA2UISurface root={root} />);
  await fireEvent(ui.getByTestId('conversation-a2ui-list-layout'), 'layout', {
    nativeEvent: { layout: { width: 520 } },
  });
  expect(
    StyleSheet.flatten(
      ui.getByTestId('conversation-a2ui-list-strip').props
        .contentContainerStyle,
    ),
  ).toMatchObject({ alignItems: 'flex-end' });
  mockFontScale = 2;
  await ui.rerender(<ConversationA2UISurface root={root} />);
  expect(
    StyleSheet.flatten(
      ui.getByTestId('conversation-a2ui-list-stack').props
        .contentContainerStyle,
    ),
  ).not.toHaveProperty('alignItems');
  expect(
    ui.getAllByText(/요약|세부 사항/u).map(node => node.props.children),
  ).toEqual(['요약', '세부 사항']);
  const legacy = restoreConversationTask({
    taskVersion: '51',
    taskType: ragConversationTask.taskType,
  });
  const fallback = {
    status: 'valid',
    value: { answerKind: 'conversation', answer },
  };
  expect(legacy?.validateResult(evidenceFree('end'), input)).toEqual(fallback);
  for (const invalid of ['spaceAround', { '@path': '/alignment' }])
    expect(
      ragConversationTask.validateResult(evidenceFree(invalid), input),
    ).toEqual(fallback);
  expect(storeConversationA2UILayout(root, answer)).toEqual({
    version: 6,
    tree: ['Card', ['HorizontalList', 0, ['Card', 0]]],
  });
});
