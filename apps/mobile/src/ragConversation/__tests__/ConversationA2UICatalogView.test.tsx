import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import {
  restoreConversationA2UILayout,
  storeConversationA2UILayout,
} from '../conversationA2UIArchive';
import { conversationA2UICatalog } from '../conversationA2UI';
import type { ConversationA2UINode } from '../conversationA2UI';

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

const label = (id: string, text: string): ConversationA2UINode => ({
  id,
  text,
  component: 'Text',
  variant: 'body',
});
const row: ConversationA2UINode = {
  id: 'row',
  component: 'Row',
  children: [
    label('a', '기간'),
    { id: 'divider', component: 'Divider', axis: 'vertical' },
    label('b', '최근 일주일'),
  ],
};
const tabs = [
  { title: '요약', child: row },
  {
    title: '세부 사항',
    child: {
      id: 'nested',
      component: 'Card',
      children: [
        {
          id: 'group',
          component: 'Column',
          children: [
            { id: 'symbol', component: 'Icon', name: 'calendarToday' },
            label('detail', '선택한 기간의 세부 사항'),
          ],
        },
      ],
    },
  },
] satisfies Extract<ConversationA2UINode, { component: 'Tabs' }>['tabs'];

function surface(children = tabs) {
  return (
    <ConversationA2UISurface
      root={{ id: 'root', component: 'Tabs', tabs: children }}
    />
  );
}

beforeEach(() => {
  mockFontScale = 1;
});

test('native tabs have named accessible controls, select only a local panel, and preserve stable selection on reordered data', async () => {
  const ui = await render(surface());
  const summaryTab = ui.getByRole('tab', { name: '요약' });
  const detailsTab = ui.getByRole('tab', { name: '세부 사항' });
  expect(summaryTab.props.accessibilityState.selected).toBe(true);
  expect(ui.queryByText('선택한 기간의 세부 사항')).toBeNull();
  expect(StyleSheet.flatten(detailsTab.props.style).minHeight).toBe(44);
  await fireEvent.press(detailsTab);
  expect(detailsTab.props.accessibilityState.selected).toBe(true);
  expect(ui.queryByText('최근 일주일')).toBeNull();
  expect(ui.getByText('선택한 기간의 세부 사항').props.allowFontScaling).toBe(
    true,
  );
  expect(ui.queryByRole('image')).toBeNull(); // A redundant bundled icon is decorative.
  expect(ui.queryByRole('link')).toBeNull();
  await ui.rerender(surface([...tabs].reverse()));
  expect(
    ui.getByRole('tab', { name: '세부 사항' }).props.accessibilityState
      .selected,
  ).toBe(true);
  await ui.rerender(surface([tabs[0]!]));
  expect(
    ui.getByRole('tab', { name: '요약' }).props.accessibilityState.selected,
  ).toBe(true);
  expect(ui.getByText('최근 일주일')).toBeTruthy();
});

test('a vertical divider adapts with its row without hiding its accessible text', async () => {
  const ui = await render(<ConversationA2UISurface root={row} />);
  const renderedRow = ui.getByTestId('conversation-a2ui-row');
  const layout = async (width: number) =>
    fireEvent(renderedRow, 'layout', { nativeEvent: { layout: { width } } });
  const divider = () =>
    ui.getByTestId('conversation-a2ui-divider', {
      includeHiddenElements: true,
    });
  expect(StyleSheet.flatten(divider().props.style).height).toBe(
    StyleSheet.hairlineWidth,
  );
  await layout(320);
  expect(StyleSheet.flatten(divider().props.style).width).toBe(
    StyleSheet.hairlineWidth,
  );
  expect(divider().props.accessibilityElementsHidden).toBe(true);
  mockFontScale = 2;
  await ui.rerender(<ConversationA2UISurface root={row} />);
  expect(StyleSheet.flatten(divider().props.style).height).toBe(
    StyleSheet.hairlineWidth,
  );
  expect(
    ui.getAllByText(/기간|일주일/u).map(text => text.props.children),
  ).toEqual(['기간', '최근 일주일']);
});

const draftId = 'orot:response:draft';
const accepted = '요약\n첫 번째 답변\n세부 사항\n두 번째 답변';
const components = [
  {
    id: 'root',
    component: 'Tabs',
    tabs: [
      { title: { '@path': '/label' }, child: 'a' },
      { title: '세부 사항', child: 'b' },
    ],
  },
  { id: 'a', component: 'Text', text: '첫 번째 답변' },
  { id: 'b', component: 'Column', children: ['symbol', 'divider', 'text'] },
  { id: 'symbol', component: 'Icon', name: 'calendarToday' },
  { id: 'divider', component: 'Divider' },
  { id: 'text', component: 'Text', text: '두 번째 답변' },
];
const create = (nodes: readonly unknown[]) =>
  JSON.stringify({
    version: '1.0',
    createSurface: {
      catalogId: conversationA2UICatalog,
      surfaceId: draftId,
      components: nodes,
    },
  });
const bind = (label: unknown, surfaceId = draftId) =>
  JSON.stringify({
    version: '1.0',
    updateDataModel: { surfaceId, path: '/label', value: label },
  });
const candidate = (
  nodes: readonly unknown[] = components,
  label: unknown = '요약',
) =>
  acceptConversationA2UIFrameSequence(
    [create(nodes), bind(label)],
    accepted,
    true,
  );

test('completed provider frames mount one validated native surface and restore its arrangement from accepted text only', async () => {
  const node = candidate();
  expect(node).toBeDefined();
  const ui = await render(<ConversationA2UISurface root={node!} />);
  expect(ui.getByText('첫 번째 답변')).toBeTruthy();
  await fireEvent.press(ui.getByRole('tab', { name: '세부 사항' }));
  expect(ui.getByText('두 번째 답변')).toBeTruthy();
  expect(
    ui.getByTestId('conversation-a2ui-divider', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
  const archive = storeConversationA2UILayout(node!, accepted);
  expect(archive).toEqual({
    version: 3,
    tree: [
      'Tabs',
      0,
      ['Column', ['Icon', 'calendarToday'], ['Divider', 'horizontal'], 0],
    ],
  });
  const restored = restoreConversationA2UILayout(archive, accepted);
  expect(restored).toBeDefined();
  await ui.unmount();
  const reopened = await render(<ConversationA2UISurface root={restored!} />);
  expect(reopened.getByText('첫 번째 답변')).toBeTruthy();
  await fireEvent.press(reopened.getByRole('tab', { name: '세부 사항' }));
  expect(reopened.getByText('두 번째 답변')).toBeTruthy();
  expect(
    restoreConversationA2UILayout(
      { version: 2, tree: archive?.tree },
      accepted,
    ),
  ).toBeUndefined();
});

test('rejects unknown icons, nonliteral labels, unowned data and hidden cyclic references without mounting', () => {
  const withIcon = (name: unknown) =>
    components.map(node => (node.id === 'symbol' ? { ...node, name } : node));
  expect(candidate(withIcon('warning'))).toBeUndefined();
  expect(candidate(withIcon({ svgPath: 'M0 0' }))).toBeUndefined();
  expect(candidate(components, '새로운 모델 문구')).toBeUndefined();
  expect(candidate(components, { '@call': 'openUrl' })).toBeUndefined();
  expect(
    acceptConversationA2UIFrameSequence(
      [create(components), bind('요약', 'orot:other:bubble')],
      accepted,
      true,
    ),
  ).toBeUndefined();
  const cycle = components.map(node =>
    node.id === 'b' ? { ...node, children: ['root'] } : node,
  );
  expect(candidate(cycle)).toBeUndefined();
});

test('V21 rejects a new catalog widget even if a later frame replaces it with plain text', () => {
  const early = create([{ id: 'root', component: 'Divider' }]);
  const repaired = JSON.stringify({
    version: '1.0',
    updateComponents: {
      surfaceId: draftId,
      components: [{ id: 'root', component: 'Text', text: 'Plain' }],
    },
  });
  expect(
    acceptConversationA2UIFrameSequence([early, repaired], 'Plain'),
  ).toBeUndefined();
  expect(
    acceptConversationA2UIFrameSequence([early, repaired], 'Plain', true),
  ).toMatchObject({ component: 'Text', text: 'Plain' });
});
