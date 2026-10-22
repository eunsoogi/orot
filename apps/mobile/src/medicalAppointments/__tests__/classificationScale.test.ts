import { classifyCalendarEvents } from '../classificationWorkflow';
import { medicalAppointmentCopy } from '../copy.ko';
import { event, input } from '../classificationWorkflowTestFixtures';

test('resolves the shared initial reason once and preserves earlier progress snapshots', async () => {
  const copy = jest.spyOn(medicalAppointmentCopy, 'manualReview', 'get');
  const snapshots: Parameters<
    NonNullable<Parameters<typeof classifyCalendarEvents>[0]['onProgress']>
  >[0][] = [];
  const result = await classifyCalendarEvents(
    input(
      Array.from({ length: 9 }, (_, index) => event(index)),
      { onProgress: progress => snapshots.push(progress) },
    ),
  );
  expect(result.status).toBe('complete');
  expect(copy).toHaveBeenCalledTimes(1);
  expect(snapshots[0]?.candidates[8]?.status).toBe('unclassified');
  expect(snapshots[1]?.candidates[8]?.status).toBe('classified');
  expect(snapshots[0]?.candidates[0]).toEqual(snapshots[1]?.candidates[0]);
  copy.mockRestore();
});
