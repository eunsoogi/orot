import { STORAGE_TABLES, parseRecord } from '@orot/storage';
import type { RecordKind, SqlDatabase } from '@orot/storage';
import { createLocalQueryProbeFixtures } from './localRecordQueryProbeFixtures';

export const scaleEndAt = '2090-01-01T00:00:00.000Z';

/** Generate valid synthetic rows in SQL batches without corpus-sized JS arrays or actual audio files. */
export async function seedAiScale(
  database: SqlDatabase,
  from: number,
  to: number,
) {
  const fixture = createLocalQueryProbeFixtures();
  const provenance = { origin: 'user_reported', sourceRecordIds: [] };
  const templates: [RecordKind, unknown][] = [
    ['source_record', { ...fixture.audioSource, contentHash: undefined }],
    [
      'health_observation',
      {
        ...fixture.healthRows[3],
        provenance: {
          ...fixture.healthRows[3]!.provenance,
          sourceRecordIds: [],
        },
      },
    ],
    ['appointment', fixture.appointment],
    [
      'transcript_segment',
      {
        ...fixture.transcript,
        text: '합성 상담 전사: 최근 복용 시간과 건강 측정 기록을 진료에서 확인해요. '.repeat(
          24,
        ),
      },
    ],
    [
      'dose_event',
      {
        ...fixture.dose,
        provenance: { ...fixture.dose.provenance, sourceRecordIds: [] },
        medicationDefinitionId: 'scale-medication',
      },
    ],
    [
      'symptom_entry',
      {
        id: 'scale-symptom-template',
        effectiveAt: scaleEndAt,
        recordedAt: scaleEndAt,
        ingestedAt: scaleEndAt,
        provenance,
        reviewState: { status: 'unreviewed' },
        description: '합성 두통',
        severity: 3,
      },
    ],
  ];
  // Active registration makes the dose history usable instead of orphaned events.
  if (!from) {
    const medication = parseRecord('medication_definition', {
      ...fixture.medication,
      id: 'scale-medication',
      provenance,
    });
    await database.execute(
      'INSERT INTO medication_definitions (id, ingested_at, payload_json) VALUES (?, ?, ?)',
      [medication.id, medication.ingestedAt, JSON.stringify(medication)],
    );
  }
  for (let offset = from; offset < to; offset += 1000) {
    await database.transaction(async tx => {
      for (const [kind, value] of templates) {
        const template = parseRecord(kind, value);
        // Fixed 90-day coverage separates corpus growth from period-window changes.
        const extra =
          kind === 'transcript_segment'
            ? ", '$.transcriptId', 'scale-transcript_segment-' || n, '$.recordingSourceId', 'scale-source_record-' || n, '$.provenance.sourceRecordIds', json_array('scale-source_record-' || n)"
            : kind === 'appointment'
              ? ", '$.calendarEventIdentifier', sample_id, '$.calendarEventSnapshot.occurrenceDate', sample_time"
              : kind === 'health_observation'
                ? `, '$.concept', CASE n % 6 WHEN 0 THEN 'heart_rate' WHEN 1 THEN 'blood pressure systolic' WHEN 2 THEN 'blood pressure diastolic' WHEN 3 THEN 'body_mass' WHEN 4 THEN 'step_count' ELSE 'sleep' END,
                  '$.observationKind', CASE WHEN n % 6 = 5 THEN 'other' ELSE 'measurement' END,
                  '$.value', json(CASE n % 6 WHEN 0 THEN '{"kind":"quantity","amount":72,"unit":"count/min"}' WHEN 1 THEN '{"kind":"quantity","amount":125,"unit":"mmHg"}' WHEN 2 THEN '{"kind":"quantity","amount":80,"unit":"mmHg"}' WHEN 3 THEN '{"kind":"quantity","amount":71.5,"unit":"kg"}' WHEN 4 THEN '{"kind":"quantity","amount":900,"unit":"count"}' ELSE '{"kind":"text","text":"asleepDeep"}' END),
                  '$.endedAt', strftime('%Y-%m-%dT%H:%M:%fZ', sample_time, '+60 seconds')`
                : '';
        await tx.execute(
          `WITH RECURSIVE sequence(n) AS (
          SELECT ? UNION ALL SELECT n + 1 FROM sequence WHERE n + 1 < ?
        ), generated AS (
          SELECT n, ? || n ${kind === 'transcript_segment' ? "|| ':r1'" : ''} AS sample_id,
            strftime('%Y-%m-%dT%H:%M:%fZ', ?, printf('-%d seconds', 1 + (n * 7919) % 7776000)) AS sample_time
          FROM sequence
        ) INSERT INTO ${STORAGE_TABLES[kind].table} (id, effective_at, recorded_at, ingested_at, payload_json)
          SELECT sample_id, sample_time, sample_time, ?,
          json_set(?, '$.id', sample_id, '$.effectiveAt', sample_time, '$.recordedAt', sample_time${extra}) FROM generated`,
          [
            offset,
            Math.min(offset + 1000, to),
            `scale-${kind}-`,
            scaleEndAt,
            scaleEndAt,
            JSON.stringify(template),
          ],
        );
      }
    });
  }
  // Check generated identities and linked transcript shape, not only the templates.
  for (const [kind] of templates) {
    const table = STORAGE_TABLES[kind].table;
    const count = (
      await database.execute(`SELECT count(*) AS count FROM ${table}`)
    ).rows[0]?.count;
    if (count !== to) throw new Error('Scale fixture count mismatch: ' + kind);
    const rows = await database.execute(
      `SELECT payload_json FROM ${table} ORDER BY id LIMIT 6`,
    );
    for (const row of rows.rows)
      parseRecord(kind, JSON.parse(String(row.payload_json)));
  }
}
