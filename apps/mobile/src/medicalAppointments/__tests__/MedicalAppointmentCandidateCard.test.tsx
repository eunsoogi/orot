import { fireEvent, render, screen } from '@testing-library/react-native';
import { MedicalAppointmentCandidateCard } from '../MedicalAppointmentCandidateCard';
import type { CandidateReview } from '../classificationWorkflow';

const candidate: CandidateReview = {
  candidateId: 'example',
  event: {
    calendarEventIdentifier: 'private-id',
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
    calendarEventSnapshot: {
      title: '정기 진료',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  },
  status: 'classified',
  classification: 'medical',
  uncertainty: 'low',
  reason: '진료 예약으로 확인됩니다.',
};

it('shows occurrence details and automatic-save state without a per-card save action', async () => {
  const view = await render(
    <MedicalAppointmentCandidateCard
      candidate={candidate}
      isSaved={false}
      isSaving
    />,
  );
  expect(screen.getByText('정기 진료')).toBeTruthy();
  expect(
    screen.getByText('2035년 6월 2일 09:00–10:00 · Asia/Seoul'),
  ).toBeTruthy();
  const details = screen.getByTestId('medical-appointment-details-example');
  expect(details.props.accessibilityState.expanded).toBe(false);
  expect(screen.queryByText(/진료 예약으로 확인됩니다/)).toBeNull();
  await fireEvent.press(details);
  expect(screen.getByText(/진료 예약으로 확인됩니다/)).toBeTruthy();
  expect(screen.getByText('저장 중입니다.')).toBeTruthy();
  expect(screen.queryByTestId('medical-appointment-save-example')).toBeNull();
  expect(screen.queryByText('private-id')).toBeNull();
  await view.rerender(
    <MedicalAppointmentCandidateCard
      candidate={candidate}
      isSaved
      isSaving={false}
    />,
  );
  expect(screen.getByText('일정을 저장했습니다.')).toBeTruthy();
  expect(screen.queryByText('저장 중입니다.')).toBeNull();
  expect(screen.getAllByRole('button')).toHaveLength(1);
});
