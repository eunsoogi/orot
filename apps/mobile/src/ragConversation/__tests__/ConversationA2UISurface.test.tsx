import { restoreConversationA2UILayout } from '../conversationA2UIArchive';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ConversationMessage } from '../ConversationMessage';
import {
  applyConversationA2UIFrame,
  conversationA2UICatalog,
  makeConversationA2UISurfaceId,
} from '../conversationA2UI';
import { possibilityReportTemplate } from '../conversationReportTemplate';
import { reference } from '../../diseaseHypotheses/taskTestSupport';

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

const surfaceId = makeConversationA2UISurfaceId('synthetic', 'bubble');
const plainLink = 'https://example.invalid/not-opened';
const textNode = (id: string, text: string, variant = 'body') => ({
  id,
  component: 'Text',
  text,
  variant,
});
const components = [
  { id: 'root', component: 'Card', child: 'vertical' },
  { id: 'vertical', component: 'Column', children: ['pair', 'entries'] },
  { id: 'pair', component: 'Row', children: ['label', 'value'] },
  { id: 'entries', component: 'List', children: ['item'] },
  textNode('label', 'Plain **formatting**'),
  textNode('value', plainLink),
  textNode('item', 'Plain caption', 'caption'),
];
function verify(nodes: readonly unknown[]) {
  return applyConversationA2UIFrame(
    null,
    JSON.stringify({
      version: '1.0',
      createSurface: {
        surfaceId,
        catalogId: conversationA2UICatalog,
        components: nodes,
      },
    }),
    surfaceId,
  )?.root;
}

const sealed = () => ({ messageId: 41, root: verify(components)! });
const fallback = 'Ordinary fallback text';
const defaultMessage = {
  id: 41,
  role: 'assistant' as const,
  content: fallback,
};
type Props = Parameters<typeof ConversationMessage>[0];
const bodyTestID = 'rag-conversation-answer-body';
function bubble(
  message: Props['message'],
  verifiedA2UI?: Props['verifiedA2UI'],
  onOpenSource = jest.fn(),
) {
  return (
    <ConversationMessage
      message={message}
      verifiedA2UI={verifiedA2UI}
      onOpenSource={onOpenSource}
      onLinkError={jest.fn()}
    />
  );
}

beforeEach(() => {
  mockFontScale = 1;
});

test('renders only verified, plain non-interactive A2UI data beside unchanged source pills', async () => {
  const onOpenSource = jest.fn();
  await render(
    bubble(
      { ...defaultMessage, citations: [reference] },
      sealed(),
      onOpenSource,
    ),
  );
  const region = within(screen.getByTestId(bodyTestID));
  const label = region.getByText('Plain **formatting**');
  expect(label.props.allowFontScaling).toBe(true);
  expect(label.props.numberOfLines).toBeUndefined();
  expect(region.getByText(plainLink).props.onPress).toBeUndefined();
  expect(region.getByText('Plain caption').props.allowFontScaling).toBe(true);
  for (const role of ['link', 'button', 'header'] as const)
    expect(region.queryAllByRole(role)).toHaveLength(0);
  expect(screen.queryByText(fallback)).toBeNull();
  const citation = screen.getByTestId('rag-conversation-message-41-citation-0');
  expect(citation.props.accessibilityRole).toBe('button');
  await fireEvent.press(citation);
  expect(onOpenSource).toHaveBeenCalledWith(reference);
});

test('rows retain reading order with no hard text cutoff and stack for narrow and large-text sizes', async () => {
  const msg = bubble(defaultMessage, sealed());
  const view = await render(msg);
  const row = () => screen.getByTestId('conversation-a2ui-row');
  const direction = () => StyleSheet.flatten(row().props.style).flexDirection;
  expect(direction()).not.toBe('row');
  await fireEvent(row(), 'layout', { nativeEvent: { layout: { width: 280 } } });
  expect(direction()).toBe('row');
  await fireEvent(row(), 'layout', { nativeEvent: { layout: { width: 180 } } });
  expect(direction()).not.toBe('row');
  await fireEvent(row(), 'layout', { nativeEvent: { layout: { width: 280 } } });
  mockFontScale = 2;
  await view.rerender(bubble(defaultMessage, sealed()));
  expect(direction()).not.toBe('row');
  expect(
    within(row())
      .getAllByText(/Plain|example/)
      .map(node => node.props.children),
  ).toEqual(['Plain **formatting**', plainLink]);
});

test.each([
  [{}, undefined],
  [{}, { messageId: -1, root: verify(components)! }],
  [{ streaming: true }, sealed()],
  [{ incomplete: true }, sealed()],
  [{ role: 'user' }, sealed()],
  [{ restoredHistory: true }, sealed()],
])(
  'keeps ordinary body fallback for absent, provisional, stale or other bubble data',
  async (state, verified) => {
    await render(
      bubble(
        { ...defaultMessage, ...state } as Props['message'],
        verified as Props['verifiedA2UI'],
      ),
    );
    expect(screen.getByText(fallback)).toBeTruthy();
    expect(screen.queryByText(plainLink)).toBeNull();
  },
);

test('invalid controls and unchanged product report templates cannot be overridden', async () => {
  const invalid = verify([
    { id: 'root', component: 'Button', action: 'unsafe' },
  ]);
  expect(invalid).toBeNull();
  const view = await render(
    bubble(
      defaultMessage,
      invalid ? { messageId: 41, root: invalid } : undefined,
    ),
  );
  expect(screen.getByText(fallback)).toBeTruthy();
  const template = possibilityReportTemplate();
  const content =
    '# ' +
    template.title +
    '\n\n' +
    template.sections
      .map((heading, index) => '## ' + heading + '\nSynthetic ' + index)
      .join('\n');
  await view.rerender(bubble({ ...defaultMessage, content }, sealed()));
  expect(
    screen.getAllByRole('header').map(node => node.props.children),
  ).toEqual([template.title, ...template.sections]);
  expect(screen.queryByText(plainLink)).toBeNull();
});

test('renders the owned restored layout in the original bubble, never another row or a stale archive', async () => {
  const accepted = 'Accepted one.\n\nAccepted two.';
  const root = restoreConversationA2UILayout(
    { version: 1, tree: ['Row', 0, 0] },
    accepted,
  )!;
  const message = {
    ...defaultMessage,
    content: accepted,
    restoredHistory: true as const,
    savedHistoryDisplayOnly: true as const,
    archivedA2UIPresentation: root,
  };
  const owned = {
    messageId: message.id,
    root,
    origin: 'owned-archive' as const,
  };
  const view = await render(bubble(message, owned));
  expect(
    within(screen.getByTestId('conversation-a2ui-row')).getByText(
      'Accepted one.',
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('conversation-a2ui-row')).getByText(
      'Accepted two.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  await view.rerender(bubble({ ...message, id: 42 }, owned));
  expect(screen.queryByTestId('conversation-a2ui-row')).toBeNull();
  await view.rerender(bubble({ ...message, historyUnavailable: true }, owned));
  expect(screen.queryByTestId('conversation-a2ui-row')).toBeNull();
});
