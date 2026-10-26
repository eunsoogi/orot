import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { makeProps, source } from '../testSupport/fixtures';

test('standalone evidence retains a local closeable sheet when no route owner is supplied', async () => {
  await render(
    <NextVisitQuestionsScreen {...makeProps({ onOpenSource: undefined })} />,
  );
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  await screen.findByTestId('next-visit-review-list');
  await fireEvent.press(screen.getByTestId('next-visit-question-details-0'));
  await fireEvent.press(screen.getByTestId('next-visit-source-0-0'));
  expect(screen.getByTestId('next-visit-source-content').props.children).toBe(
    source.content,
  );
  await fireEvent.press(screen.getByTestId('next-visit-source-close'));
  expect(screen.queryByTestId('next-visit-source-sheet')).toBeNull();
});
