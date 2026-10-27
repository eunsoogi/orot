import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { makeProps, source } from '../testSupport/fixtures';

test('standalone evidence retains its excerpt, timestamp, review state, and closeable sheet', async () => {
  await render(
    <NextVisitQuestionsScreen {...makeProps({ onOpenSource: undefined })} />,
  );
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  await fireEvent.press(screen.getByTestId('next-visit-question-details-0'));
  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(screen.getByText(/내 건강 기록 · 2035/u)).toBeTruthy();
  expect(screen.getByText('아직 검토되지 않은 자료')).toBeTruthy();
  expect(screen.getByTestId('next-visit-source-content').props.children).toBe(
    source.content,
  );
  await fireEvent.press(screen.getByTestId('next-visit-source-close'));
  expect(screen.queryByTestId('next-visit-source-sheet')).toBeNull();
});
