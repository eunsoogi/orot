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

async function setup() {
  const connection = openSqliteTestDatabase(':memory:');
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

test('automatic records are idempotent, preserve edits and disappear with their source and history', async () => {
  const x = await setup();
  try {
    const [saved] = await x.official.saveAutomatic(x.result, {
      loadCurrentInput: x.loadCurrentInput,
    });
    expect(saved).toMatchObject({
      sourceMethod: 'ai_generated',
      editOrigin: 'ai_analysis',
      answer: null,
      revision: 1,
      automaticSource: { binding: x.result.binding, result: x.result.questions[0] },
    });
    expect(
      await x.official.saveAutomatic(x.result, { loadCurrentInput: x.loadCurrentInput }),
    ).toEqual([saved]);
    const edited = await x.official.edit({
      id: saved.id,
      expectedRevision: 1,
      answer: '사용자 수정',
    });
    expect(
      (await x.official.saveAutomatic(x.result, { loadCurrentInput: x.loadCurrentInput }))[0],
    ).toEqual(edited);
    const segment = x.result.sources[0];
    await x.records.transcripts.correct(segment.segmentId, '새 전사 내용', '2026-11-06T00:00:00Z');
    const revised = structuredClone(x.result);
    let current!: Awaited<ReturnType<typeof x.loadCurrentInput>>;
    await x.database.transaction(async (sql) => {
      current = await x.loadCurrentInput(sql);
    });
    revised.sources[0] = {
      segmentId: current.segments[0].id,
      transcriptId: current.segments[0].transcriptId,
      revision: current.segments[0].revision,
      audioRange: current.segments[0].audioRange,
    };
    revised.questions[0].questionEvidence = [
      {
        ...revised.questions[0].questionEvidence[0],
        segmentId: current.segments[0].id,
        revision: current.segments[0].revision,
        quote: current.segments[0].text.slice(0, 3),
      },
    ];
    revised.questions[0].answers = [];
    await expect(
      x.official.saveAutomatic(revised, { loadCurrentInput: x.loadCurrentInput }),
    ).rejects.toThrow('preserve the user edit');
    expect(await x.official.history(saved.id)).toEqual([saved, edited]);
    await x.records.sourceRecords.delete(x.result.recordingSourceId);
    expect(await x.official.listForAppointment(x.result.appointmentId)).toEqual([]);
    expect(await x.official.history(saved.id)).toEqual([]);
  } finally {
    x.close();
  }
});

test('rejects absent evidence and changed binding or question snapshots before writing', async () => {
  const x = await setup();
  try {
    const absent = structuredClone(x.result);
    absent.questions[0] = {
      questionId: absent.questions[0].questionId,
      status: 'not_found',
      questionEvidence: [],
      answers: [],
    };
    await expect(
      x.official.saveAutomatic(absent, { loadCurrentInput: x.loadCurrentInput }),
    ).rejects.toThrow('No asked question');
    await x.database.execute('UPDATE test_binding SET version = 2');
    await expect(
      x.official.saveAutomatic(x.result, { loadCurrentInput: x.loadCurrentInput }),
    ).rejects.toThrow('snapshot changed');
    await x.database.execute('UPDATE test_binding SET version = 1');
    const question = (await x.records.get('visit_question', x.result.questions[0].questionId))!;
    await x.records.put('visit_question', { ...question, questionText: '변경' });
    await x.records.put('visit_question', question);
    await expect(
      x.official.saveAutomatic(x.result, { loadCurrentInput: x.loadCurrentInput }),
    ).rejects.toThrow('snapshot changed');
    expect(await x.official.listForAppointment(x.result.appointmentId)).toEqual([]);
  } finally {
    x.close();
  }
});

test('rechecks the stored question after loading the snapshot and rolls back a concurrent change', async () => {
  const x = await setup();
  try {
    const loader = async (sql: SqlExecutor) => {
      const snapshot = await x.loadCurrentInput(sql);
      await sql.execute(
        "UPDATE visit_questions SET payload_json = json_set(payload_json, '$.questionText', 'changed') WHERE id = ?",
        [snapshot.questions[0].id],
      );
      return snapshot;
    };
    await expect(x.official.saveAutomatic(x.result, { loadCurrentInput: loader })).rejects.toThrow(
      'prepared question changed',
    );
    expect(await x.official.listForAppointment(x.result.appointmentId)).toEqual([]);
    expect(await readVisitQuestionRevision(x.database, x.result.questions[0].questionId)).toBe(
      'v1:1',
    );
  } finally {
    x.close();
  }
});

test('rejects a snapshot with fabricated transcript text even when its ID and quotation match', async () => {
  const x = await setup();
  try {
    const loader = async (sql: SqlExecutor) => {
      const snapshot = await x.loadCurrentInput(sql);
      return {
        ...snapshot,
        segments: [{ ...snapshot.segments[0], text: snapshot.segments[0].text + '조작' }],
      };
    };
    await expect(x.official.saveAutomatic(x.result, { loadCurrentInput: loader })).rejects.toThrow(
      'transcript revision changed',
    );
    expect(await x.official.listForAppointment(x.result.appointmentId)).toEqual([]);
  } finally {
    x.close();
  }
});
