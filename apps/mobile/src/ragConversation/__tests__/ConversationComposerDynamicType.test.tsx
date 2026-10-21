import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Native from 'react-native';
import { ConversationComposer } from '../ConversationComposer';

const props = {
  busy: false,
  onChangeText: jest.fn(),
  onSend: jest.fn(),
  onCancel: jest.fn(),
};
const dimensions = { width: 402, height: 874, scale: 3, fontScale: 3.12 };
const input = () => screen.getByTestId('rag-conversation-input');
const inputStyle = () => Native.StyleSheet.flatten(input().props.style);
const originalDimensions = Native.Dimensions.get('window');

beforeEach(() => Native.Dimensions.set({ window: dimensions }));
afterEach(() => Native.Dimensions.set({ window: originalDimensions }));

test('fits scaled placeholder lines without fixing typed content height', async () => {
  const view = await render(<ConversationComposer {...props} value="" />);
  const lineWithInsets = Math.ceil(22 * dimensions.fontScale + 22);
  expect(inputStyle().minHeight).toBeGreaterThanOrEqual(lineWithInsets);
  expect(inputStyle().height).toBeGreaterThanOrEqual(lineWithInsets);
  await fireEvent(input(), 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 180 } },
  });
  expect(inputStyle().height).toBe(180);
  expect(input().props.scrollEnabled).toBe(false);
  await view.rerender(<ConversationComposer {...props} value="합성 질문" />);
  expect(inputStyle().height).toBeUndefined();
});

test('bounds large drafts, then resets a cleared editor and a changed text size', async () => {
  const view = await render(
    <ConversationComposer {...props} value={'첫 줄\n둘째 줄\n셋째 줄'} />,
  );
  expect(inputStyle().maxHeight).toBeGreaterThan(96);
  expect(inputStyle().maxHeight).toBeLessThanOrEqual(dimensions.height / 3);
  await fireEvent(input(), 'contentSizeChange', {
    nativeEvent: { contentSize: { height: 500 } },
  });
  expect(input().props.scrollEnabled).toBe(true);
  expect(inputStyle().height).toBeUndefined();
  await view.rerender(<ConversationComposer {...props} value="" />);
  expect(input().props.scrollEnabled).toBe(false);
  expect(inputStyle().height).toBe(Math.ceil(22 * dimensions.fontScale + 22));
  await act(() => {
    Native.Dimensions.set({ window: { ...dimensions, fontScale: 1 } });
  });
  await view.rerender(<ConversationComposer {...props} value="" />);
  expect(inputStyle()).toMatchObject({
    minHeight: 44,
    maxHeight: 96,
    height: 44,
  });
});
