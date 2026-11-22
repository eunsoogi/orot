import {
  buildRecentRecordEntries,
  groupRecentRecords,
} from './RecordsRecentTimeline';

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

test('does not reorder an indexed source across a page boundary at submillisecond precision', () => {
  const rows = buildRecentRecordEntries(
    [],
    [],
    [],
    [
      {
        id: 'z-older',
        key: 'z-older',
        kind: 'medical_document',
        createdAt: '2026-11-22T12:00:00.000100Z',
      },
      {
        id: 'a-newer',
        key: 'a-newer',
        kind: 'audio_recording',
        createdAt: '2026-11-22T21:00:00.000200+09:00',
      },
    ],
  );
  expect(rows.map(row => row.id)).toEqual(['a-newer', 'z-older']);
});
