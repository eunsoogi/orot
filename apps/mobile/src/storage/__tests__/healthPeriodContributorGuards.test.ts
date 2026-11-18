import { localQueryTimestampKey } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { previousHealthPeriodGuards } from '../testSupport/previousHealthPeriodGuards';
import { healthPeriodDeletionGuards as prototypeGuards } from '../healthPeriodContributorGuards';

test('full trigger guards are byte identical and unknown topics fail', () => {
  expect(prototypeGuards()).toEqual(previousHealthPeriodGuards());
  for (const invalid of ['unknown', '', null])
    expect(() => prototypeGuards(invalid as never)).toThrow('Unknown topic');
});

test('topic predicates preserve three-valued clinical, numeric, interval and binding semantics', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    const base = {
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count' },
      startedAt: '2026-10-02T01:00:00Z',
      endedAt: '2026-10-02T02:00:00Z',
    };
    const cases: Array<Record<string, unknown>> = [base];
    for (const observationKind of [
      undefined,
      null,
      'diagnosis',
      'allergy',
      'procedure',
      'activity',
    ])
      cases.push({ ...base, observationKind });
    for (const concept of [
      'glucose',
      'step_count',
      'STEP_COUNT',
      'workout_duration',
      'WORKOUT_DURATION',
      'sleep',
      'HKCategoryTypeIdentifierSleepAnalysis',
    ])
      cases.push({ ...base, concept });
    for (const value of [
      { kind: 'text', text: 'x' },
      { kind: 'quantity', amount: '72', unit: 'count' },
      { kind: 'quantity', amount: 72, unit: 3 },
      { kind: 'quantity', amount: null, unit: 'count' },
      { kind: 'quantity', amount: 72.25, unit: 'count' },
    ])
      cases.push({ ...base, value });
    for (const endedAt of [
      null,
      '2026-10-01T00:00:00Z',
      '2026-10-01T00:00:00.001Z',
      '2026-09-29T00:00:00Z',
    ])
      for (const concept of ['workout_duration', 'sleep', 'WORKOUT_DURATION'])
        cases.push({ ...base, concept, endedAt, at: '2026-09-30T23:00:00Z' });
    cases.push({ ...base, at: '2026-10-05T00:00:00Z' });
    for (const topic of [
      'measurements',
      'activity',
      'sleep',
      'symptoms',
      'medications',
    ]) {
      const original = previousHealthPeriodGuards(),
        candidate = prototypeGuards(
          topic as Parameters<typeof prototypeGuards>[0],
        );
      const table =
        topic === 'symptoms'
          ? 'symptom_entries'
          : topic === 'medications'
            ? 'dose_events'
            : 'health_observations';
      for (const record of cases) {
        const sql = `SELECT (${original[table]}) AS original, (${candidate[table]}) AS candidate FROM (SELECT ? AS payload_json,? AS effective_at) OLD CROSS JOIN (SELECT ? AS topic,? AS from_key,? AS to_key) p`;
        const args = [
          JSON.stringify(record),
          String(record.at ?? '2026-10-02T01:00:00Z'),
          topic,
          localQueryTimestampKey('2026-10-01T00:00:00Z'),
          localQueryTimestampKey('2026-10-05T00:00:00Z'),
        ];
        const row = (await f.database.execute(sql, args)).rows[0];
        // WHERE admission must match, including unknown clinical kinds represented by NULL.
        expect(Boolean(row.original)).toBe(Boolean(row.candidate));
        const mismatched = (
          await f.database.execute(
            `SELECT (${candidate[table]}) AS allowed FROM (SELECT ? AS payload_json,? AS effective_at) OLD CROSS JOIN (SELECT ? AS topic,? AS from_key,? AS to_key) p`,
            [args[0], args[1], 'wrong-topic', args[3], args[4]],
          )
        ).rows[0];
        expect(Boolean(mismatched.allowed)).toBe(false);
      }
      if (topic === 'medications')
        for (const t of ['medication_definitions', 'medication_assertions'])
          expect(candidate[t]).toBe(original[t]);
    }
  } finally {
    f.close();
  }
});
