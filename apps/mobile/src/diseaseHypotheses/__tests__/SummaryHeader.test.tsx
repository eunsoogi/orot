import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SummaryHeader } from '../SummaryHeader';

test('opens saved summaries from the trailing native glass history action', async () => {
  const open = jest.fn();
  await render(
    <SummaryHeader title="증상 정리" disabled={false} onOpenHistory={open} />,
  );
  expect(screen.getByTestId('symptom-summary-history-glass')).toBeTruthy();
  const action = screen.getByRole('button', { name: '저장된 요약 보기' });
  expect(StyleSheet.flatten(action.props.style)).toMatchObject({
    width: 44,
    height: 44,
  });
  await fireEvent.press(action);
  expect(open).toHaveBeenCalledTimes(1);
});
