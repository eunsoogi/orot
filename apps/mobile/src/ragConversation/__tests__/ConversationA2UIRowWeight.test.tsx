import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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
const surfaceId = 'orot:response:draft';
const answer = '요약\n세부 사항';
const frames = (
  weight: unknown = 2.5,
  component = 'Row',
  frameSurfaceId = surfaceId,
) => [
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: frameSurfaceId,
      catalogId: conversationA2UICatalog,
      components: [
        { id: 'root', component: 'Card', child: 'row' },
        { id: 'row', component, children: ['first', 'details'] },
        { id: 'first', component: 'Text', text: '요약' },
        { id: 'details', component: 'Text', text: '세부 사항', weight },
      ],
    },
  }),
];

test('same-mount weighted card yields 1:2.5 native flex on wide layout and readable order on narrow or large text', async () => {
  mockFontScale = 1;
  const root = acceptConversationA2UIFrameSequence(
    frames(),
    answer,
    true,
    true,
    true,
  );
  expect(root).toBeDefined();
  const ui = await render(<ConversationA2UISurface root={root!} />);
  const row = () => ui.getByTestId('conversation-a2ui-row');
  const setWidth = (width: number) =>
    fireEvent(row(), 'layout', { nativeEvent: { layout: { width } } });
  const widthRatios = () =>
    row().children.map(child => {
      if (typeof child === 'string')
        throw new Error('Expected native row item');
      return StyleSheet.flatten(child.props.style)?.flexGrow;
    });
  await setWidth(500);
  expect(widthRatios()).toEqual([1, 2.5]);
  await setWidth(350);
  expect(widthRatios()).toEqual([undefined, undefined]);
  await setWidth(500);
  mockFontScale = 2;
  await ui.rerender(<ConversationA2UISurface root={root!} />);
  expect(widthRatios()).toEqual([undefined, undefined]);
  expect(
    ui.getAllByText(/요약|세부 사항/u).map(node => node.props.children),
  ).toEqual(['요약', '세부 사항']);
});

test('weight remains inert outside a permitted committed owned layout and cannot enter older archives', () => {
  expect(
    acceptConversationA2UIFrameSequence(frames(), answer, true, true),
  ).toBeUndefined();
  const accept = (raw: string[], prose = answer) =>
    acceptConversationA2UIFrameSequence(raw, prose, true, true, true);
  for (const invalid of [0, 4, '2', { '@path': '/weight' }])
    expect(accept(frames(invalid))).toBeUndefined();
  expect(accept(frames(2, 'Column'))).toBeUndefined();
  expect(accept(frames(2, 'Row', 'foreign-surface'))).toBeUndefined();
  expect(accept(frames(), 'Other\nContent')).toBeUndefined();
  const archive = storeConversationA2UILayout(accept(frames())!, answer);
  expect(archive).toEqual({
    version: 5,
    tree: ['Card', ['Row', 0, ['WeightedText', 2.5]]],
  });
  expect(restoreConversationA2UILayout(archive, answer)).toMatchObject({
    children: [
      { children: [{ text: '요약' }, { text: '세부 사항', weight: 2.5 }] },
    ],
  });
  expect(
    restoreConversationA2UILayout({ version: 4, tree: archive?.tree }, answer),
  ).toBeUndefined();
  expect(
    restoreConversationA2UILayout(
      { version: 5, tree: ['Column', 0, ['WeightedText', 2.5]] },
      answer,
    ),
  ).toBeUndefined();
});
