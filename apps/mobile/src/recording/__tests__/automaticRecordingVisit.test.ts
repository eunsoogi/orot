import type { Appointment } from '@orot/domain';
import {
  revalidateAutomaticRecordingVisit,
  selectAutomaticRecordingVisit,
} from '../automaticRecordingVisit';

const now = '2026-11-16T10:00:00.000Z';
function visit(id: string, effectiveAt: string, status = 'scheduled') {
  return { id, effectiveAt, status } as Appointment;
}
function loader(...values: Appointment[]) {
  return jest.fn(async () => ({ list: jest.fn(async () => values) }));
}
const future = visit('nearest', '2026-11-16T11:00:00.000Z');

test('selects the nearest explicit scheduled future visit, excluding invalid or terminal rows', async () => {
  const load = loader(
    visit('past', '2026-11-16T09:00:00Z'),
    visit('present', now),
    visit('bad', '2026-02-30T11:00:00Z'),
    visit('cancelled', '2026-11-16T10:01:00Z', 'cancelled'),
    visit('completed', '2026-11-16T10:01:00Z', 'completed'),
    visit('rescheduled', '2026-11-16T10:01:00Z', 'rescheduled'),
    visit('later', '2026-11-16T12:00:00Z'),
    future,
  );
  expect(await selectAutomaticRecordingVisit(now, load)).toEqual(future);
});

test('orders equivalent offset times by stable ID without locale collation', async () => {
  const a = visit('A', '2026-11-16T20:00:00+09:00');
  const b = visit('b', '2026-11-16T11:00:00Z');
  for (const rows of [
    [b, a],
    [a, b],
  ])
    expect(await selectAutomaticRecordingVisit(now, loader(...rows))).toEqual(
      a,
    );
});

test('preserves submillisecond ordering and returns a detached snapshot', async () => {
  const closest = visit('z', '2026-11-16T10:00:00.0001Z');
  const selected = await selectAutomaticRecordingVisit(
    now,
    loader(visit('a', '2026-11-16T10:00:00.0002Z'), closest),
  );
  expect(selected).toEqual(closest);
  expect(selected).not.toBe(closest);
});

test('returns null for invalid now, empty data, and storage failure', async () => {
  const load = loader(future);
  expect(await selectAutomaticRecordingVisit('invalid', load)).toBeNull();
  expect(load).not.toHaveBeenCalled();
  expect(await selectAutomaticRecordingVisit(now, loader())).toBeNull();
  const failed = jest.fn(async () => {
    throw new Error('locked');
  });
  expect(await selectAutomaticRecordingVisit(now, failed)).toBeNull();
});

test('revalidates only the original identity, exact time and scheduled status', async () => {
  const selected = await selectAutomaticRecordingVisit(now, loader(future));
  expect(
    await revalidateAutomaticRecordingVisit(selected, loader(future)),
  ).toBe(future.id);
  for (const changed of [
    visit('other', future.effectiveAt),
    visit(future.id, '2026-11-16T12:00:00Z'),
    visit(future.id, future.effectiveAt, 'cancelled'),
    visit(future.id, future.effectiveAt, 'completed'),
    visit(future.id, future.effectiveAt, 'rescheduled'),
  ])
    expect(
      await revalidateAutomaticRecordingVisit(selected, loader(changed)),
    ).toBeNull();
  expect(
    await revalidateAutomaticRecordingVisit(selected, loader()),
  ).toBeNull();
  expect(
    await revalidateAutomaticRecordingVisit(selected, async () => {
      throw new Error('locked');
    }),
  ).toBeNull();
  const load = loader(future);
  expect(await revalidateAutomaticRecordingVisit(null, load)).toBeNull();
  expect(load).not.toHaveBeenCalled();
});
