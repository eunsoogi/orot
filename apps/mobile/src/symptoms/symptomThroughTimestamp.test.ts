import { toSymptomThroughTimestamp, toSymptomTimestamp } from './dateTime';

test('through includes the whole local minute, including a repeated hour', () => {
  const start = toSymptomTimestamp('2025-11-02', '01:30')!;
  const end = toSymptomThroughTimestamp('2025-11-02', '01:30')!;
  expect(new Date(end).getTime()).toBeGreaterThanOrEqual(
    new Date(start).getTime() + 59999,
  );
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/New_York') {
    expect(start).toBe('2025-11-02T05:30:00.000Z');
    expect(end).toBe('2025-11-02T06:30:59.999Z');
  }
});

test('invalid local times do not become period boundaries', () => {
  expect(toSymptomThroughTimestamp('2026-02-30', '09:30')).toBeNull();
});
