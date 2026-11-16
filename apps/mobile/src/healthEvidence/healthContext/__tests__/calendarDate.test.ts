import { dayFormatter, dayStart, shiftDate } from '../calendarDate';

test('reuses civil boundaries across topics without repeated Intl work', () => {
  const formatter = dayFormatter('Asia/Tokyo');
  const format = jest.spyOn(formatter, 'formatToParts');
  const boundaries = Array.from({ length: 91 }, (_, n) =>
    dayStart(shiftDate('2025-07-01', n), formatter),
  );
  const coldCalls = format.mock.calls.length;
  for (let topic = 0; topic < 5; topic++) {
    const reused = dayFormatter('Asia/Tokyo');
    expect(reused).toBe(formatter);
    boundaries.forEach((boundary, n) => {
      expect(dayStart(shiftDate('2025-07-01', n), reused)).toBe(boundary);
    });
  }
  expect(coldCalls).toBeGreaterThan(91);
  expect(format).toHaveBeenCalledTimes(coldCalls);
  format.mockRestore();
});

test('bounds retained zones and dates and isolates civil timezones', () => {
  const first = dayFormatter('Pacific/Honolulu');
  const format = jest.spyOn(first, 'formatToParts');
  const original = dayStart('2025-01-01', first);
  for (let n = 1; n <= 128; n++) dayStart(shiftDate('2025-01-01', n), first);
  format.mockClear();
  expect(dayStart('2025-01-01', first)).toBe(original);
  expect(format).toHaveBeenCalled();
  format.mockRestore();
  for (const zone of ['UTC', 'Asia/Seoul', 'Europe/London', 'America/New_York'])
    dayFormatter(zone);
  expect(dayFormatter('Pacific/Honolulu')).not.toBe(first);
  expect(dayStart('2025-01-01', dayFormatter('UTC'))).not.toBe(original);
});
