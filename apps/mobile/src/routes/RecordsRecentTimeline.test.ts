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

test('globally compares source and material instants and uses binary Unicode id ties', () => {
  const older = '2026-11-22T12:00:00.000100Z';
  const latest = '2026-11-22T21:00:00.000200+09:00';
  const rows = buildRecentRecordEntries(
    [],
    [],
    [
      {
        key: 'memory:older',
        id: 'memory:older',
        origin: 'memory',
        createdAt: older,
      },
      {
        key: 'memory:new',
        id: 'memory:new',
        origin: 'memory',
        createdAt: latest,
      },
    ],
    [
      {
        key: 'tie-\uE000',
        id: 'tie-\uE000',
        kind: 'medical_document',
        createdAt: latest,
      },
      {
        key: 'tie-\u{10000}',
        id: 'tie-\u{10000}',
        kind: 'audio_recording',
        createdAt: latest,
      },
      {
        key: 'old-photo',
        id: 'old-photo',
        kind: 'medical_document',
        createdAt: older,
      },
    ],
  );
  expect(rows.map(row => row.id)).toEqual([
    'tie-\u{10000}',
    'tie-\uE000',
    'memory:new',
    'old-photo',
    'memory:older',
  ]);
});
