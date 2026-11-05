import { render, screen } from '@testing-library/react-native';
import { NextVisitQuestionsScreen } from '../NextVisitQuestionsScreen';
import { appointment, makeProps, questions } from '../testSupport/fixtures';

test('does not show saved questions while the loaded appointment does not match', async () => {
  const props = makeProps({
    savedQuestions: {
      status: 'ready',
      appointmentId: appointment.id,
      questions,
      caveats: ['conflicting_records'],
    },
  });
  const { rerender } = await render(<NextVisitQuestionsScreen {...props} />);
  expect(screen.getByTestId('next-visit-saved-list')).toBeTruthy();

  const nextAppointment = { ...appointment, id: 'synthetic-appointment-2' };
  // A stale snapshot stays hidden until the current visit's list is loaded.
  await rerender(
    <NextVisitQuestionsScreen
      {...props}
      appointment={{ status: 'ready', appointment: nextAppointment }}
    />,
  );

  expect(screen.getByTestId('next-visit-saved-loading')).toBeTruthy();
  expect(screen.queryByTestId('next-visit-saved-list')).toBeNull();
  expect(screen.queryByText(questions[0].questionText)).toBeNull();

  const nextQuestions = [
    { ...questions[0], questionText: '새 예약에 불러온 질문입니다.' },
  ];
  await rerender(
    <NextVisitQuestionsScreen
      {...props}
      appointment={{ status: 'ready', appointment: nextAppointment }}
      savedQuestions={{
        status: 'ready',
        appointmentId: nextAppointment.id,
        questions: nextQuestions,
        caveats: [],
      }}
    />,
  );
  expect(screen.getByTestId('next-visit-saved-list')).toBeTruthy();
  expect(screen.getByText(nextQuestions[0].questionText)).toBeTruthy();
});
