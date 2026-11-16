import { fireEvent, render, screen } from '@testing-library/react-native';
import { AutoGrowingQuestionInput } from '../AutoGrowingQuestionInput';

/** Synthetic events cover height wiring; UIKit last-line rendering is checked separately. */
test('fits native multiline height including borders and grows or shrinks after edits', async () => {
  const onChangeText = jest.fn();
  const onContentSizeChange = jest.fn();
  await render(
    <AutoGrowingQuestionInput
      testID="synthetic-growing-question"
      value="합성 긴 질문의 마지막 문장입니다."
      onChangeText={onChangeText}
      onContentSizeChange={onContentSizeChange}
      style={{ minHeight: 44, padding: 12, borderWidth: 1 }}
    />,
  );
  const input = screen.getByTestId('synthetic-growing-question');
  expect(input.props.multiline).toBe(true);
  expect(input.props.scrollEnabled).toBe(false);
  await fireEvent(input, 'contentSizeChange', {
    nativeEvent: { contentSize: { width: 140, height: 701.2 } },
  });
  expect(input).toHaveStyle({ height: 704, minHeight: 44, padding: 12 });
  await fireEvent.changeText(input, '짧은 질문');
  expect(onChangeText).toHaveBeenCalledWith('짧은 질문');
  await fireEvent(input, 'contentSizeChange', {
    nativeEvent: { contentSize: { width: 140, height: 80 } },
  });
  expect(input).toHaveStyle({ height: 82 });
  expect(onContentSizeChange).toHaveBeenCalledTimes(2);
  await fireEvent(input, 'contentSizeChange', {
    nativeEvent: { contentSize: { width: 140, height: NaN } },
  });
  expect(input).toHaveStyle({ height: 82 });
});
