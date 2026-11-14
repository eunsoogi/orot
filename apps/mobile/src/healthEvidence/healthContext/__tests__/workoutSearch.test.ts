import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readEvidenceCandidates } from '../../evidenceCandidates';
import { evidenceRagSearchQuery } from '../../evidenceCandidateScope';

it('retains sport intent when retrieving mixed workout records', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const [activityName, activityType] of [
      ['swimming', 46],
      ['running', 37],
      ['yoga', 57],
    ] as const) {
      await repository.put('health_observation', {
        id: activityName,
        effectiveAt: '2026-10-04T10:00:00Z',
        recordedAt: '2026-10-04T10:00:00Z',
        ingestedAt: '2026-10-04T11:00:00Z',
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
        observationKind: 'measurement',
        concept: 'workout_duration',
        value: { kind: 'quantity', amount: 30, unit: 'min' },
        workout: { activityName, activityType },
      });
    }
    expect(evidenceRagSearchQuery('최근 수영 기록')).toBe('swimming');
    expect(evidenceRagSearchQuery('최근 달리기 기록')).toBe('running');
    const selected = await readEvidenceCandidates(database, '최근 수영 기록');
    // Candidate selection retains bounded fallback evidence, but the requested sport must rank first.
    expect(selected.candidates[0]?.record.id).toBe('swimming');
    const running = await readEvidenceCandidates(database, '최근 달리기 기록');
    expect(running.candidates[0]?.record.id).toBe('running');
    const broad = await readEvidenceCandidates(database, '운동 기록');
    expect(
      broad.candidates.map(candidate => candidate.record.id).sort(),
    ).toEqual(['running', 'swimming', 'yoga']);
  } finally {
    close();
  }
});
