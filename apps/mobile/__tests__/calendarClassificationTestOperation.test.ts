import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { classifyCalendarEvents } from '../src/medicalAppointments/classificationWorkflow';
import { runCalendarClassificationTestOperation } from '../e2e/calendarClassificationTestOperation';

jest.mock('@orot/provider-apple', () => ({
  AppleFoundationModelsProvider: jest.fn(),
}));
jest.mock('../src/providers/apple/nativeBridge', () => ({
  appleFoundationModelsNativeBridge: {},
}));
jest.mock('../src/medicalAppointments/classificationWorkflow', () => ({
  classifyCalendarEvents: jest.fn(),
}));

const availability = jest.fn();
const classify = jest.mocked(classifyCalendarEvents);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(AppleFoundationModelsProvider).mockImplementation(
    () =>
      ({
        getAvailability: availability,
      }) as unknown as AppleFoundationModelsProvider,
  );
  availability.mockResolvedValue({ status: 'available' });
  classify.mockImplementation(async input => ({
    status: 'complete',
    completedBatches: 1,
    totalBatches: 1,
    candidates: input.events.map((event, index) => ({
      event,
      candidateId: `calendar-candidate-${index + 1}`,
      status: 'classified',
      classification:
        index === 0 ? 'medical' : index === 1 ? 'non_medical' : 'uncertain',
      uncertainty: index === 2 ? 'high' : 'low',
      reason: 'Synthetic unit classifier',
    })),
  }));
});

it('passes all original inputs to each classification and uses real session save paths without duplicate occurrences', async () => {
  const result = await runCalendarClassificationTestOperation();
  expect(classify).toHaveBeenCalledTimes(2);
  for (const [input] of classify.mock.calls) {
    expect(
      input.events.map(event => event.calendarEventSnapshot.title),
    ).toEqual(['내과 진료', '팀 점심', '방문 일정']);
    expect(input.remoteProcessing).toBe(false);
    expect(typeof input.consent.authorize).toBe('function');
  }
  expect(result.runs).toHaveLength(2);
  for (const run of result.runs) {
    expect(run.saves).toEqual(['saved']);
    expect(run.stored.map(appointment => appointment.id)).toEqual([
      'synthetic-appointment-1',
    ]);
  }
  expect(result.stored).toHaveLength(1);
});

it('keeps unavailable native models explicit without starting inference or writes', async () => {
  availability.mockResolvedValue({ status: 'modelNotReady' });
  expect(await runCalendarClassificationTestOperation()).toEqual({
    availability: 'modelNotReady',
    runs: [],
    stored: [],
  });
  expect(classify).not.toHaveBeenCalled();
});

it('does not retry an incomplete first import', async () => {
  classify.mockResolvedValueOnce({
    status: 'unavailable',
    candidates: [],
    completedBatches: 0,
    totalBatches: 1,
  });
  const result = await runCalendarClassificationTestOperation();
  expect(classify).toHaveBeenCalledTimes(1);
  expect(result.runs).toHaveLength(1);
  expect(result.stored).toEqual([]);
});
