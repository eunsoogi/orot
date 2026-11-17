import { queryHealthEvidenceRows } from '../../healthEvidence/localEvidenceQueries';
import { VisitQuestionRecordSchema } from '@orot/domain';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';
import { createLocalHealthEvidenceRepository } from '../../healthEvidence/localEvidenceRepository';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import { visibleVisitQuestionRecords } from '../visibleVisitQuestionRecords';

/** Raw encrypted backup restoration must not turn an old official record into provider evidence. */
test('official visit record source, candidates and selected chunks all fence legacy periods without erasing history', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const old = VisitQuestionRecordSchema.parse({
      id: 'official',
      appointmentId: 'appointment',
      questionId: 'old-question',
      questionText: 'private old question',
      questionRevision: 'v1:1',
      questionSources: [
        {
          healthContextSources: [
            {
              scope: f.source.scope,
              revision: f.source.revision,
              deletionGeneration: f.source.deletionGeneration,
            },
          ],
        },
      ],
      revision: 1,
      sourceMethod: 'manual_confirmed',
      editOrigin: 'manual_confirmation',
      answer: 'private answer',
      effectiveAt: '2026-10-05T00:00:00Z',
      recordedAt: '2026-10-05T00:00:00Z',
      ingestedAt: '2026-10-05T00:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    });
    await f.repository.delete('health_observation', 'candidate');
    await f.database.execute(
      'INSERT INTO visit_question_records(id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
      [
        old.id,
        old.effectiveAt!,
        old.recordedAt!,
        old.ingestedAt,
        JSON.stringify(old),
      ],
    );
    const sourceReader = createLocalHealthEvidenceRepository(f.database);
    expect(
      await sourceReader.readRecord('visit_question_record', old.id),
    ).toBeNull();
    const data = createLocalEvidenceData(f.database);
    expect(
      await data.loadCurrentChunks([
        { kind: 'visit_question_record', id: old.id },
      ]),
    ).toEqual([]);
    expect(
      (await data.readCandidates('private old question')).candidates.some(
        entry => entry.record.id === old.id,
      ),
    ).toBe(false);
    const visible = visibleVisitQuestionRecords(f.database);
    expect(await visible.listForAppointment('appointment')).toEqual([]);
    expect(await visible.history(old.id)).toEqual([]);
    expect(await visible.unavailableForAppointment('appointment')).toEqual([
      {
        id: 'official',
        questionId: 'old-question',
        reason: 'unverifiable_legacy_period',
        recovery: 'regenerate',
      },
    ]);
    expect(
      (
        await f.database.execute(
          'SELECT payload_json FROM visit_question_records WHERE id=?',
          [old.id],
        )
      ).rows[0]?.payload_json,
    ).toBe(JSON.stringify(old));
    // A hidden first row must not consume a caller's visible inventory limit.
    const plain = { ...old, id: 'z-visible', questionSources: [] };
    await f.database.execute(
      'INSERT INTO visit_question_records(id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
      [
        plain.id,
        plain.effectiveAt!,
        plain.recordedAt!,
        plain.ingestedAt,
        JSON.stringify(plain),
      ],
    );
    expect(
      (
        await queryHealthEvidenceRows(
          f.database,
          'visit_question_record',
          { kind: 'all' },
          1,
        )
      ).map(row => row.id),
    ).toEqual(['z-visible']);
    await f.repository.delete('health_observation', 'duplicate');
    expect(
      (
        await f.database.execute(
          'SELECT id FROM visit_question_records WHERE id=?',
          [old.id],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    f.close();
  }
});
