import { recapInput, recapResult } from '../../domain/__tests__/recap-fixtures';
import {
  createVisitQuestionRecordRepository,
  openEncryptedStorage,
  readVisitQuestionRevision,
} from '../src';
import type { SqlExecutor } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { createOptions } from './manualHistoryTestSupport';
import { audioSourceRecord } from './sourceEvidenceTestSupport';

export async function setupAutomatic(path = ':memory:') {
  const connection = openSqliteTestDatabase(path);
  const records = await openEncryptedStorage(createOptions(connection.database));
  const base = recapInput();
  const segment = base.segments[0];
  const time = '2026-11-05T00:00:00Z';
  await records.put('appointment', {
    id: base.appointmentId,
    status: 'scheduled',
    effectiveAt: time,
    recordedAt: time,
    ingestedAt: time,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  await records.put('visit_question', {
    id: base.questions[0].id,
    appointmentId: base.appointmentId,
    questionText: base.questions[0].questionText,
    priority: 'routine',
    evidenceSpanIds: [],
    effectiveAt: time,
    recordedAt: time,
    ingestedAt: time,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  await records.sourceRecords.create(audioSourceRecord(base.recordingSourceId));
  await records.transcripts.append([segment]);
  // This fixture represents the future binding owner; reads use the write transaction.
  await connection.database.execute(
    'CREATE TABLE test_binding (fingerprint TEXT, version INTEGER)',
  );
  await connection.database.execute('INSERT INTO test_binding VALUES (?, ?)', [
    base.binding.fingerprint,
    base.binding.version,
  ]);
  const loadCurrentInput = async (sql: SqlExecutor) => {
    const binding = (await sql.execute('SELECT fingerprint, version FROM test_binding')).rows[0];
    const question = (
      await sql.execute('SELECT payload_json FROM visit_questions WHERE id = ?', [
        base.questions[0].id,
      ])
    ).rows[0];
    const rows = await sql.execute(
      "SELECT payload_json FROM transcript_segments WHERE json_extract(payload_json, '$.recordingSourceId') = ? ORDER BY json_extract(payload_json, '$.revision') DESC LIMIT 1",
      [base.recordingSourceId],
    );
    const stored = JSON.parse(String(question.payload_json));
    return {
      ...base,
      binding: { fingerprint: String(binding.fingerprint), version: Number(binding.version) },
      questions: [
        {
          id: stored.id,
          appointmentId: stored.appointmentId,
          questionText: stored.questionText,
          revision: (await readVisitQuestionRevision(sql, stored.id))!,
        },
      ],
      segments: rows.rows.map((row) => JSON.parse(String(row.payload_json))),
    };
  };
  let current!: Awaited<ReturnType<typeof loadCurrentInput>>;
  await connection.database.transaction(async (sql) => {
    current = await loadCurrentInput(sql);
  });
  const result = recapResult(current);
  const evidence = {
    segmentId: segment.id,
    transcriptId: segment.transcriptId,
    revision: segment.revision,
    startOffset: 0,
    endOffset: 3,
    quote: segment.text.slice(0, 3),
    audioRange: segment.audioRange,
  };
  result.questions[0] = {
    questionId: current.questions[0].id,
    status: 'evidence_found',
    questionEvidence: [evidence],
    answers: [
      {
        quotation: evidence.quote,
        summary: '요약',
        speaker: 'unknown',
        inferredRole: 'uncertain',
        speakerUncertainty: '화자 미확인',
        evidence: [evidence],
      },
    ],
  };
  return {
    ...connection,
    records,
    loadCurrentInput,
    result,
    official: createVisitQuestionRecordRepository(connection.database, { clock: () => time }),
  };
}
