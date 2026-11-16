import { fireEvent, render, screen } from '@testing-library/react-native';
import { AutoGrowingQuestionInput } from '../AutoGrowingQuestionInput';

/** Synthetic layout events cover wiring, not UIKit wrapping or Dynamic Type geometry. */
test('fits the independent text layout and preserves editing without a second accessible label', async () => {
  const onChangeText = jest.fn();
  const { rerender } = await render(
    <AutoGrowingQuestionInput
      testID="synthetic-growing-question"
      value="합성 긴 질문의 마지막 문장입니다."
      onChangeText={onChangeText}
      style={{ minHeight: 44, padding: 12, borderWidth: 1, fontSize: 16 }}
    />,
  );
  const input = screen.getByTestId('synthetic-growing-question');
  const mirror = screen.getByTestId('synthetic-growing-question-measurement', {
    includeHiddenElements: true,
  });
  expect(input.props.multiline).toBe(true);
  expect(input.props.scrollEnabled).toBe(false);
  expect(mirror.props.accessibilityElementsHidden).toBe(true);
  expect(mirror.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(mirror.props.children).toBe(input.props.value);
  await fireEvent(mirror, 'layout', {
    nativeEvent: { layout: { width: 140, height: 701.2 } },
  });
  expect(input).toHaveStyle({
    height: 702,
    minHeight: 44,
    padding: 12,
    lineHeight: 24,
  });
  await fireEvent.changeText(input, '짧은 질문');
  expect(onChangeText).toHaveBeenCalledWith('짧은 질문');
  await rerender(
    <AutoGrowingQuestionInput
      testID="synthetic-growing-question"
      value="짧은 질문"
      onChangeText={onChangeText}
      style={{ minHeight: 44, padding: 12, borderWidth: 1, fontSize: 16 }}
    />,
  );
  expect(mirror.props.children).toBe('짧은 질문');
  expect(input.props.value).toBe('짧은 질문');
  await fireEvent(mirror, 'layout', {
    nativeEvent: { layout: { width: 140, height: 80 } },
  });
  expect(input).toHaveStyle({ height: 80 });
  await fireEvent(mirror, 'layout', {
    nativeEvent: { layout: { width: 140, height: NaN } },
  });
  expect(input).toHaveStyle({ height: 80 });
});
