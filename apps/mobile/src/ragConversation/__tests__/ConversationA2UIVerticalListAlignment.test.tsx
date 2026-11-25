import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';

const answer = '요약\n세부 사항\n참고';
const surfaceId = 'orot:response:draft';
const frame = (list: Record<string, unknown>) =>
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: 'Card', child: 'contents' },
        { id: 'contents', component: 'Column', children: ['list', 'strip'] },
        {
          id: 'list',
          component: 'List',
          children: ['summary', 'details'],
          ...list,
        },
        {
          id: 'strip',
          component: 'List',
          direction: 'horizontal',
          children: ['aside'],
        },
        { id: 'summary', component: 'Text', text: '요약' },
        { id: 'details', component: 'Text', text: '세부 사항' },
        { id: 'aside', component: 'Text', text: '참고' },
      ],
    },
  });
const accept = (frames: readonly string[]) =>
  acceptConversationA2UIFrameSequence(
    frames,
    answer,
    true,
    true,
    true,
    'vertical_align',
  );

test('the mounted bubble positions a vertical List using the model’s cross-axis token', async () => {
  const root = accept([frame({ align: 'end' })]);
  expect(root).toBeDefined();
  const view = await render(<ConversationA2UISurface root={root!} />);
  expect(
    StyleSheet.flatten(view.getByTestId('conversation-a2ui-list').props.style)
      ?.alignItems,
  ).toBe('flex-end');
  expect(
    view.getAllByText(/요약|세부 사항|참고/u).map(node => node.props.children),
  ).toEqual(['요약', '세부 사항', '참고']);
  const archive = storeConversationA2UILayout(root!, answer);
  expect(archive).toEqual({
    version: 7,
    tree: [
      'Card',
      ['Column', ['Aligned', 'List', 'end', null, 0, 0], ['HorizontalList', 0]],
    ],
  });
  const restored = restoreConversationA2UILayout(archive, answer);
  expect(restored).toBeDefined();
  await view.rerender(<ConversationA2UISurface root={restored!} />);
  expect(
    StyleSheet.flatten(view.getByTestId('conversation-a2ui-list').props.style)
      ?.alignItems,
  ).toBe('flex-end');
  expect(
    restoreConversationA2UILayout({ version: 6, tree: archive?.tree }, answer),
  ).toBeUndefined();
});

test('rejects layout bindings, horizontal alignment, foreign frames and old task capabilities', () => {
  const valid = frame({ align: 'center' });
  expect(accept([valid])).toBeDefined();
  expect(
    acceptConversationA2UIFrameSequence(
      [valid],
      answer,
      true,
      true,
      true,
      true,
    ),
  ).toBeUndefined();
  for (const extra of [
    { align: 'baseline' },
    { align: null },
    { align: { '@path': '/layout' } },
    { align: 'center', justify: 'end' },
    { align: 'center', direction: 'horizontal' },
  ])
    expect(accept([frame(extra)])).toBeUndefined();
  const update = JSON.stringify({
    version: '1.0',
    updateComponents: {
      surfaceId: 'other-surface',
      components: [
        {
          id: 'list',
          component: 'List',
          children: ['summary', 'details'],
          align: 'start',
        },
      ],
    },
  });
  expect(accept([valid, update])).toBeUndefined();
});
