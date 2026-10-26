import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { makeProps } from '../testSupport/fixtures';

test('reflows the active question editor without replaying generation', async () => {
  const props = makeProps();
  await render(<NextVisitQuestionsScreen {...props} />);

  const columns = screen.getByTestId('next-visit-question-columns');
  const host = screen.getByTestId('next-visit-question-columns-host');
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  const question = await screen.findByTestId('next-visit-question-text-0');
  await fireEvent.changeText(question, 'edited visit question');
  await fireEvent(host, 'layout', {
    nativeEvent: { layout: { width: 1400, height: 600, x: 0, y: 0 } },
  });

  expect(StyleSheet.flatten(columns.props.style)?.flexDirection).toBe('row');
  expect(question.props.value).toBe('edited visit question');
  expect(props.onGenerate).toHaveBeenCalledTimes(1);

  await fireEvent(host, 'layout', {
    nativeEvent: { layout: { width: 1200, height: 600, x: 0, y: 0 } },
  });
  expect(StyleSheet.flatten(columns.props.style)?.flexDirection).toBe('column');
  expect(question.props.value).toBe('edited visit question');
  expect(props.onGenerate).toHaveBeenCalledTimes(1);
});
