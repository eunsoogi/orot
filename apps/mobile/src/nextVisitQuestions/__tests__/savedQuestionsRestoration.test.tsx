import { fireEvent, render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { appointment, makeProps, questions } from '../testSupport/fixtures';

test('keeps a restoration notice separate from evidence caveats during review', async () => {
  const restorationNotice =
    '이전 질문의 불확실성 안내는 저장되지 않아 복원할 수 없어요.';
  const props = makeProps({
    savedQuestions: {
      status: 'ready',
      appointmentId: appointment.id,
      questions,
      caveats: [],
      restorationNotice,
    },
  });

  // This storage limitation is explanatory text, not a newly inferred caveat.
  await render(<NextVisitQuestionsScreen {...props} />);
  expect(
    screen.getByTestId('next-visit-saved-restoration-notice'),
  ).toBeTruthy();
  expect(screen.getByText(restorationNotice)).toBeTruthy();
  expect(
    screen.queryByTestId('next-visit-caveat-conflicting_records'),
  ).toBeNull();

  await fireEvent.press(screen.getByTestId('next-visit-saved-edit'));
  expect(
    screen.getByTestId('next-visit-saved-restoration-notice'),
  ).toBeTruthy();
});
