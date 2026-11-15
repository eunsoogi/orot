import type { DailyReportSourceRecord } from '@orot/domain';
import { dailyReportCoverageCounts } from '../dailyReportCoverageCounts';

function record(source: string, recordId: string): DailyReportSourceRecord {
  return {
    source,
    recordId,
    revision: `revision-${recordId}`,
    occurrence: { startInclusive: '2026-11-10T01:00:00.000Z' },
    ingestedAt: '2026-11-10T01:01:00.000Z',
  };
}

test('counts only records present in the report snapshot by source', () => {
  const counts = dailyReportCoverageCounts([
    record('health_observation', 'synthetic-health-1'),
    record('health_observation', 'synthetic-health-2'),
    record('symptom_entry', 'synthetic-symptom-1'),
  ]);

  expect(counts.get('health_observation')).toBe(2);
  expect(counts.get('symptom_entry')).toBe(1);
  expect(counts.has('dose_event')).toBe(false);
});

test('keeps the count unavailable when the saved context has no source snapshot', () => {
  expect(dailyReportCoverageCounts(undefined)).toBeUndefined();
});

test('ongoing symptoms count with their queried source, without becoming new daily events', () => {
  const counts = dailyReportCoverageCounts([
    record('symptom_entry', 'today'),
    { ...record('symptom_entry', 'old'), contextRole: 'ongoing_symptom' },
  ]);
  expect(counts.get('symptom_entry')).toBe(2);
});
