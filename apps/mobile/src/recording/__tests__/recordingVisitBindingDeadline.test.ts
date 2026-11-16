import { bindRecordingToUnchangedVisit } from '@orot/storage';
import { bindAutomaticRecordingVisit } from '../bindAutomaticRecordingVisit';
jest.mock('@orot/storage', () => ({
  bindRecordingToUnchangedVisit: jest.fn(),
}));

const visit = {
  id: 'synthetic',
  effectiveAt: '2026-12-01T00:00:00Z',
  status: 'scheduled' as const,
};
afterEach(() => jest.useRealTimers());
test('a late database open cannot insert an association after its deadline', async () => {
  jest.useFakeTimers();
  let open!: (value: never) => void;
  const load = jest.fn(
    () =>
      new Promise<never>(resolve => {
        open = resolve;
      }),
  );
  const binding = bindAutomaticRecordingVisit('recording', visit, load);
  await jest.advanceTimersByTimeAsync(1500);
  await binding;
  open({} as never);
  await Promise.resolve();
  await Promise.resolve();
  expect(bindRecordingToUnchangedVisit).not.toHaveBeenCalled();
});
test('a stalled transaction loses its commit lease while the screen can finish saving', async () => {
  jest.useFakeTimers();
  const load = jest.fn(async () => ({}) as never);
  let commitAllowed!: () => boolean;
  jest
    .mocked(bindRecordingToUnchangedVisit)
    .mockImplementationOnce(async (_db, _id, _visit, canCommit) => {
      commitAllowed = canCommit!;
      return new Promise(() => {});
    });
  const binding = bindAutomaticRecordingVisit('recording', visit, load);
  await jest.advanceTimersByTimeAsync(0);
  expect(commitAllowed()).toBe(true);
  await jest.advanceTimersByTimeAsync(1500);
  await binding;
  expect(commitAllowed()).toBe(false);
});
