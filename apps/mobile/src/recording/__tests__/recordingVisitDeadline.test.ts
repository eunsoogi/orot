import { selectAutomaticRecordingVisit } from '../automaticRecordingVisit';
import { selectRecordingVisitWithinDeadline } from '../bindAutomaticRecordingVisit';
jest.mock('../automaticRecordingVisit', () => ({
  selectAutomaticRecordingVisit: jest.fn(),
}));
jest.mock('@orot/storage', () => ({
  bindRecordingToUnchangedVisit: jest.fn(),
}));
afterEach(() => jest.useRealTimers());
test('a stalled appointment read stops delaying capture and cannot supply a late candidate', async () => {
  jest.useFakeTimers();
  let complete!: (value: {
    id: string;
    effectiveAt: string;
    status: 'scheduled';
  }) => void;
  jest.mocked(selectAutomaticRecordingVisit).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = resolve;
      }),
  );
  const candidate = selectRecordingVisitWithinDeadline('2026-11-16T10:00:00Z');
  await jest.advanceTimersByTimeAsync(1500);
  expect(await candidate).toBeNull();
  complete({
    id: 'late',
    effectiveAt: '2026-12-01T00:00:00Z',
    status: 'scheduled',
  });
  expect(await candidate).toBeNull();
});
