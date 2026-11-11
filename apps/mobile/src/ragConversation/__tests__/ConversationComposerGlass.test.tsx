import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { ConversationComposer } from '../ConversationComposer';
import { ConversationScreen } from '../ConversationScreen';

const originalDimensions = Dimensions.get('window');
// The 44pt baseline is the standard text-size contract, not Jest's default 2x font scale.
beforeEach(() =>
  Dimensions.set({ window: { ...originalDimensions, fontScale: 1 } }),
);
afterEach(() => Dimensions.set({ window: originalDimensions }));

test('keeps the borderless Glass field and one native action for Send and Stop', async () => {
  const props = {
    value: '합성 질문',
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    onCancel: jest.fn(),
  };
  const view = await render(<ConversationComposer {...props} busy={false} />);
  const field = screen.getByTestId('rag-conversation-composer-field');
  expect(StyleSheet.flatten(field.props.style)).toMatchObject({
    borderWidth: 0,
    borderRadius: 28,
    overflow: 'hidden',
  });
  const send = screen.getByTestId('rag-conversation-send');
  expect(within(field).getByTestId('rag-conversation-send')).toBe(send);
  // Exercise the native event directly; a generic press can bubble to the public wrapper and hide a broken bridge.
  expect(send.props.onPress).toBeUndefined();
  expect(send.props.onComposerPress).toEqual(expect.any(Function));
  // UIKit exposes the actual 44pt button; the full input material must not become a second AX action.
  expect(send.props.accessible).toBe(false);
  expect(send.props.accessibilityLabel).toBeUndefined();
  expect(send.props).toMatchObject({
    busy: false,
    disabled: false,
    actionTestID: 'rag-conversation-send',
  });
  await fireEvent(send, 'composerPress');
  expect(props.onSend).toHaveBeenCalledTimes(1);
  await view.rerender(<ConversationComposer {...props} value="" busy />);
  expect(screen.getByTestId('rag-conversation-cancel').props).toMatchObject({
    busy: true,
    disabled: false,
  });
  await fireEvent(
    screen.getByTestId('rag-conversation-cancel'),
    'composerPress',
  );
  expect(props.onCancel).toHaveBeenCalledTimes(1);
  await view.rerender(
    <ConversationComposer {...props} value="" busy={false} />,
  );
  expect(screen.getByTestId('rag-conversation-send').props.disabled).toBe(true);
});

test('mounts one passive Glass surface behind the multiline field', async () => {
  await render(
    <ConversationComposer
      value={'첫 줄\n둘째 줄'}
      busy={false}
      onChangeText={jest.fn()}
      onSend={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  const field = screen.getByTestId('rag-conversation-composer-field');
  const surfaces = within(field).getAllByTestId(
    'rag-conversation-composer-glass',
  );
  expect(surfaces).toHaveLength(1);
  expect(surfaces[0].type).toBe('ComposerGlassView');
  expect(surfaces[0].props.pointerEvents).toBe('none');
  expect(StyleSheet.flatten(surfaces[0].props.style)).toMatchObject({
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
  expect(
    StyleSheet.flatten(screen.getByTestId('rag-conversation-input').props.style)
      .backgroundColor,
  ).toBe('transparent');
});

test('keeps the composer outside the conversation scroll', async () => {
  await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
      onSend={async () => ({ status: 'no_evidence' })}
    />,
  );
  const composer = screen.getByTestId('rag-conversation-composer');
  expect(StyleSheet.flatten(composer.props.style).position).toBeUndefined();
  expect(
    within(screen.getByTestId('rag-conversation-history')).queryByTestId(
      'rag-conversation-composer',
    ),
  ).toBeNull();
});

test('shares a 44pt single-line baseline and grows without flex compressing the text', async () => {
  const props = {
    busy: false,
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    onCancel: jest.fn(),
  };
  const view = await render(<ConversationComposer {...props} value="one" />);
  const input = () => screen.getByTestId('rag-conversation-input');
  const fieldStyle = StyleSheet.flatten(
    screen.getByTestId('rag-conversation-composer-field').props.style,
  );
  expect(fieldStyle.padding ?? 0).toBe(0);
  expect(StyleSheet.flatten(input().props.style)).toMatchObject({
    minHeight: 44,
    lineHeight: 22,
    paddingTop: 11,
    paddingBottom: 11,
  });
  expect(StyleSheet.flatten(input().props.style).flex).toBeUndefined();
  expect(StyleSheet.flatten(input().props.style).paddingRight).toBe(58);
  expect(StyleSheet.flatten(input().props.style).height).toBeUndefined();
  await view.rerender(
    <ConversationComposer {...props} value={'one\ntwo\nthree'} />,
  );
  await fireEvent(input(), 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 88 } },
  });
  expect(input().props.scrollEnabled).toBe(true);
  await view.rerender(<ConversationComposer {...props} value="" />);
  expect(input().props.scrollEnabled).toBe(true);
  expect(StyleSheet.flatten(input().props.style).height).toBe(44);
});
