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

test('uses borderless native Glass surfaces and one action control for Send and Stop', async () => {
  const props = {
    value: '합성 질문',
    onChangeText: jest.fn(),
    onSend: jest.fn(),
    onCancel: jest.fn(),
  };
  const view = await render(<ConversationComposer {...props} busy={false} />);
  expect(
    StyleSheet.flatten(
      screen.getByTestId('rag-conversation-composer-field').props.style,
    ),
  ).toMatchObject({ borderWidth: 0, borderRadius: 28, overflow: 'hidden' });
  const send = screen.getByTestId('rag-conversation-send');
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
  expect(
    StyleSheet.flatten(
      screen.getByTestId('rag-conversation-action-slot').props.style,
    ),
  ).toMatchObject({
    backgroundColor: 'transparent',
    minWidth: 44,
    minHeight: 44,
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

test('keeps the composer inside the conversation page', async () => {
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
    within(screen.getByTestId('rag-conversation-history')).getByTestId(
      'rag-conversation-composer',
    ),
  ).toBeTruthy();
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
  expect(StyleSheet.flatten(input().props.style).height).toBeUndefined();
  expect(
    StyleSheet.flatten(
      screen.getByTestId('rag-conversation-action-slot').props.style,
    ).marginBottom ?? 0,
  ).toBe(0);
  await view.rerender(
    <ConversationComposer {...props} value={'one\ntwo\nthree'} />,
  );
  await fireEvent(input(), 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 88 } },
  });
  expect(input().props.scrollEnabled).toBe(false);
  await view.rerender(<ConversationComposer {...props} value="" />);
  expect(input().props.scrollEnabled).toBe(false);
  expect(StyleSheet.flatten(input().props.style).height).toBe(44);
});
