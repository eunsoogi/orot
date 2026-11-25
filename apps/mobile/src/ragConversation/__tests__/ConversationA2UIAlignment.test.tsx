import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 390,
    height: 844,
    scale: 3,
    fontScale: mockFontScale,
  }),
}));

const surfaceId = 'orot:response:draft';
const answer = '요약\n세부 사항';
const nodes = [
  {
    id: 'root',
    component: 'Column',
    align: 'end',
    justify: 'center',
    children: ['row'],
  },
  {
    id: 'row',
    component: 'Row',
    align: 'center',
    justify: 'spaceBetween',
    children: ['a', 'b'],
  },
  { id: 'a', component: 'Text', text: '요약' },
  { id: 'b', component: 'Text', text: '세부 사항' },
];
const frames = (components: readonly unknown[]) => [
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId,
      catalogId: conversationA2UICatalog,
      components,
    },
  }),
];
const adopt = (components: readonly unknown[] = nodes) =>
  acceptConversationA2UIFrameSequence(frames(components), answer, true, true);

beforeEach(() => {
  mockFontScale = 1;
});

test('V24 renders model-chosen directions on the native axes and retains reading order at large type', async () => {
  const root = adopt();
  expect(root).toBeDefined();
  const ui = await render(<ConversationA2UISurface root={root!} />);
  const column = () =>
    StyleSheet.flatten(ui.getByTestId('conversation-a2ui-column').props.style);
  const row = () => ui.getByTestId('conversation-a2ui-row');
  await fireEvent(row(), 'layout', { nativeEvent: { layout: { width: 330 } } });
  expect(column()).toMatchObject({
    alignItems: 'flex-end',
    justifyContent: 'center',
  });
  expect(StyleSheet.flatten(row().props.style)).toMatchObject({
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  });
  mockFontScale = 2;
  await ui.rerender(<ConversationA2UISurface root={root!} />);
  expect(StyleSheet.flatten(row().props.style)).not.toHaveProperty(
    'justifyContent',
  );
  expect(
    ui.getAllByText(/요약|세부 사항/u).map(node => node.props.children),
  ).toEqual(['요약', '세부 사항']);
  expect(ui.getByText('세부 사항').props.allowFontScaling).toBe(true);
});

test('older capability, arbitrary style values, and changed prose fail closed', () => {
  expect(
    acceptConversationA2UIFrameSequence(frames(nodes), answer, true),
  ).toBeUndefined();
  const withRow = (props: object) =>
    nodes.map(node => (node.id === 'row' ? { ...node, ...props } : node));
  expect(adopt(withRow({ align: { '@path': '/other' } }))).toBeUndefined();
  expect(
    adopt(withRow({ justify: 'https://example.invalid' })),
  ).toBeUndefined();
  expect(adopt(withRow({ opacity: 0 }))).toBeUndefined();
  expect(
    adopt(
      nodes.map(node =>
        node.id === 'a' ? { ...node, text: 'Changed' } : node,
      ),
    ),
  ).toBeUndefined();
});

test('a v4 archive keeps only the layout tokens and rejects them under previous versions', () => {
  const root = adopt();
  expect(root).toBeDefined();
  const archive = storeConversationA2UILayout(root!, answer);
  expect(archive).toEqual({
    version: 4,
    tree: [
      'Aligned',
      'Column',
      'end',
      'center',
      ['Aligned', 'Row', 'center', 'spaceBetween', 0, 0],
    ],
  });
  expect(restoreConversationA2UILayout(archive, answer)).toMatchObject({
    component: 'Column',
    alignment: { align: 'end', justify: 'center' },
  });
  expect(
    restoreConversationA2UILayout({ version: 3, tree: archive?.tree }, answer),
  ).toBeUndefined();
  expect(
    restoreConversationA2UILayout(
      { version: 4, tree: ['Aligned', 'Column', 'end', 'system', 0, 0] },
      answer,
    ),
  ).toBeUndefined();
});
