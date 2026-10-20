import { compareTimestamps } from '@orot/domain';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import {
  createRecordRepository,
  parseRecord,
  runMigrations,
} from '@orot/storage';
import { createLocalQueryProbeFixtures } from '../../../e2e/localRecordQueryProbeFixtures';
import { createHealthEvidenceTestDatabase } from '../localEvidenceTestSupport';
import { readRankedEvidencePage } from '../rankedEvidencePages';
import type { RankedEvidenceCursor } from '../rankedEvidencePages';

type Expected = {
  id: string;
  at: string;
  concept: string;
  score: number;
  sourceAccepted: boolean;
  diversity: number;
};
const kinds = [
  'health_observation',
  'symptom_entry',
  'appointment',
  'transcript_segment',
] as const;
const instants = [
  '2090-01-01T00:00:00Z',
  '2090-01-01T09:00:00+09:00',
  '2090-01-01T00:00:00.0001Z',
  '2090-01-02T00:00:00Z',
];
const byScoreTimeId = (a: Expected, b: Expected) =>
  b.score - a.score ||
  -compareTimestamps(a.at, b.at) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Independent array ordering oracle covers folded terms, diverse concepts and exact scoped cursor boundaries. */
test.each(kinds)(
  'retains complete ranked pages and scope for %s',
  async kind => {
    const { database, close } = createHealthEvidenceTestDatabase();
    try {
      await runMigrations(database);
      const repository = createRecordRepository(database);
      const fixture = createLocalQueryProbeFixtures();
      await repository.put('source_record', {
        ...fixture.audioSource,
        id: 'ordering-audio',
      });
      const expected: Expected[] = [];
      const transcripts: TranscriptEvidenceSegment[] = [];
      for (let index = 0; index < 32; index += 1) {
        const at = instants[index % instants.length]!;
        const text = ['ALPHA BETA', 'ALPHA', 'other'][index % 3]!;
        const metadata = {
          id: `ordering-${index.toString().padStart(2, '0')}`,
          effectiveAt: at,
          recordedAt: at,
          ingestedAt: '2091-01-01T00:00:00Z',
          provenance: {
            origin: 'user_reported',
            sourceRecordIds: index % 2 ? [] : ['ordering-audio'],
          },
          reviewState: { status: 'unreviewed' },
        };
        const record = parseRecord(
          kind,
          kind === 'health_observation'
            ? { ...fixture.healthRows[3], ...metadata, concept: text }
            : kind === 'symptom_entry'
              ? { ...metadata, description: text }
              : kind === 'appointment'
                ? {
                    ...fixture.appointment,
                    ...metadata,
                    calendarEventSnapshot: {
                      ...fixture.appointment.calendarEventSnapshot,
                      title: text,
                      occurrenceDate: at,
                    },
                  }
                : {
                    ...fixture.transcript,
                    ...metadata,
                    id: metadata.id + ':r1',
                    transcriptId: metadata.id,
                    segmentOrdinal: index,
                    recordingSourceId: 'ordering-audio',
                    text,
                    provenance: {
                      ...fixture.transcript.provenance,
                      sourceRecordIds: ['ordering-audio'],
                    },
                  },
        );
        if (kind === 'transcript_segment')
          transcripts.push(parseRecord('transcript_segment', record));
        else await repository.put(kind, parseRecord(kind, record));
        const payload = JSON.stringify(record).toLowerCase();
        expected.push({
          id: record.id,
          at,
          concept: text,
          score: ['alpha', 'beta'].filter(term => payload.includes(term))
            .length,
          sourceAccepted: kind === 'transcript_segment' || index % 2 === 0,
          diversity: 1,
        });
      }
      if (transcripts.length) await repository.transcripts.append(transcripts);
      for (const query of ['alpha beta', '']) {
        for (const filter of ['all', 'period', 'source-and-period'] as const) {
          const from = instants[2]!,
            to = instants[3]!;
          const scope =
            filter === 'all'
              ? undefined
              : {
                  timeRange: { fromInclusive: from, toExclusive: to },
                  ...(filter === 'source-and-period'
                    ? { sourceIds: ['ordering-audio'] }
                    : {}),
                };
          const rows = expected
            .filter(
              row =>
                filter === 'all' ||
                (compareTimestamps(row.at, from) >= 0 &&
                  compareTimestamps(row.at, to) < 0 &&
                  (filter !== 'source-and-period' || row.sourceAccepted)),
            )
            .map(row => ({ ...row, score: query ? row.score : 0 }));
          if (kind === 'health_observation') {
            for (const concept of new Set(rows.map(row => row.concept)))
              rows
                .filter(row => row.concept === concept)
                .sort(byScoreTimeId)
                .forEach((row, index) => {
                  row.diversity = index + 1;
                });
          }
          rows.sort(
            (a, b) =>
              b.score - a.score ||
              a.diversity - b.diversity ||
              byScoreTimeId(a, b),
          );
          const actual: string[] = [];
          let cursor: RankedEvidenceCursor | null = null;
          do {
            const page = await readRankedEvidencePage(database, kind, query, {
              limit: 5,
              cursor,
              scope,
            });
            expect(page.incomplete).toBe(false);
            expect(page.records.length).toBeLessThanOrEqual(5);
            actual.push(...page.records.map(row => row.record.id));
            cursor = page.nextCursor;
            expect(actual.length).toBeLessThanOrEqual(rows.length);
          } while (cursor);
          expect(actual).toEqual(rows.map(row => row.id));
        }
      }
    } finally {
      close();
    }
  },
);
