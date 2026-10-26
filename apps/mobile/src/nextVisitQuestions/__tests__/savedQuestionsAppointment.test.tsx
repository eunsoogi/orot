import { render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { appointment, makeProps } from '../testSupport/fixtures';

test('keeps saved-list errors scoped to the appointment that failed to load', async () => {
  const props = makeProps({
    savedQuestions: {
      status: 'error',
      appointmentId: appointment.id,
      questions: [],
      message: '합성 예약 A의 목록 조회 오류',
    },
  });
  const { rerender } = await render(<NextVisitQuestionsScreen {...props} />);
  expect(screen.getByTestId('next-visit-saved-error')).toBeTruthy();

  const nextAppointment = { ...appointment, id: 'synthetic-appointment-2' };
  // Keep the previous visit's failure while the next visit is still loading.
  await rerender(
    <NextVisitQuestionsScreen
      {...props}
      appointment={{ status: 'ready', appointment: nextAppointment }}
    />,
  );

  expect(screen.getByTestId('next-visit-saved-loading')).toBeTruthy();
  expect(screen.queryByTestId('next-visit-saved-error')).toBeNull();
  expect(screen.queryByTestId('next-visit-saved-retry')).toBeNull();

  const nextErrorMessage = '합성 예약 B의 목록 조회 오류';
  await rerender(
    <NextVisitQuestionsScreen
      {...props}
      appointment={{ status: 'ready', appointment: nextAppointment }}
      savedQuestions={{
        status: 'error',
        appointmentId: nextAppointment.id,
        questions: [],
        message: nextErrorMessage,
      }}
    />,
  );

  expect(screen.getByTestId('next-visit-saved-error')).toBeTruthy();
  expect(screen.getByText(nextErrorMessage)).toBeTruthy();
  expect(screen.getByTestId('next-visit-saved-retry')).toBeTruthy();
});
