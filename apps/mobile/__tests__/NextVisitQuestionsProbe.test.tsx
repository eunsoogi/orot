import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { NextVisitQuestionsProbe } from '../e2e/nextVisitQuestionsProbe';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('the retained native probe opens the editor, completes generation and saves the reviewed draft', async () => {
  await render(<NextVisitQuestionsProbe />);
  await fireEvent.press(screen.getByTestId('next-visit-probe-close-tools'));
  await fireEvent.press(await screen.findByTestId('next-visit-generate'));
  await fireEvent.press(screen.getByTestId('next-visit-probe-tools'));
  await fireEvent.press(
    await screen.findByTestId('next-visit-probe-complete-generation'),
  );
  const input = await screen.findByTestId('next-visit-question-text-2');
  await fireEvent.changeText(input, '수정한 질문');
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  await waitFor(() => expect(screen.getByText('수정한 질문')).toBeTruthy());
  expect(screen.getByTestId('next-visit-save-message')).toBeTruthy();
});
