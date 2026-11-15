import { groupRecentRecords } from './RecordsRecentTimeline';

test('preserves the local calendar year in older record group labels', () => {
  const date = new Date(2024, 2, 4, 12);
  const records = [
    {
      id: 'synthetic-record',
      kind: 'recording' as const,
      timestamp: date.toISOString(),
      title: 'Synthetic',
    },
  ];
  const [group] = groupRecentRecords(records, new Date(2026, 2, 4, 12));
  expect(group.label).toBe(
    `2024년 ${date.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })}`,
  );
  expect(group.records[0]).toBe(records[0]);
});
