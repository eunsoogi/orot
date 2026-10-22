import { visitHealthFixture } from '../testing/healthContextFixture';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';

test.each([
  'medications',
  'measurements',
  'activity',
  'sleep',
  'symptoms',
] as const)(
  'removes %s-derived question text, persisted memory and an already-open memory engine after contributing data deletion',
  async topic => {
    const f = await visitHealthFixture(topic);
    const memory = await f.memory();
    try {
      await f.save({ memory });
      expect(
        await memory.recall('기간별 건강 기록', { minSimilarity: 0 }),
      ).toHaveLength(1);
      await f.records.delete(
        topic === 'medications'
          ? 'dose_event'
          : topic === 'symptoms'
            ? 'symptom_entry'
            : 'health_observation',
        topic === 'medications' ? 'period-dose' : 'period-observation',
      );
      expect(await f.records.list('visit_question')).toHaveLength(0);
      expect(
        (await f.database.execute('SELECT id FROM agent_memory_records')).rows,
      ).toHaveLength(0);
      expect(
        await memory.recall('기간별 건강 기록', { minSimilarity: 0 }),
      ).toHaveLength(0);
      expect(await f.prepared.revalidateEvidence([f.item])).toBe(false);
    } finally {
      await memory.close();
      f.close();
    }
  },
);

test('fences a delayed memory write when its contributing health data is deleted after question commit', async () => {
  const f = await visitHealthFixture();
  const memory = await f.memory();
  try {
    const result = await f.save({
      memory: {
        remember: async input => {
          await f.records.delete('health_observation', f.observation.id);
          return memory.remember(input);
        },
      },
    });
    expect(result.memoryStatus).toBe('retry_required');
    expect(await f.records.list('visit_question')).toHaveLength(0);
    expect(
      await memory.recall('기간별 건강 기록', { minSimilarity: 0 }),
    ).toHaveLength(0);
    expect(
      (await f.database.execute('SELECT id FROM agent_memory_records')).rows,
    ).toHaveLength(0);
  } finally {
    await memory.close();
    f.close();
  }
});

test('preserves unrelated historical data deletion, but purges a period when its contributor moves out before deletion', async () => {
  const f = await visitHealthFixture();
  try {
    await f.save();
    await f.records.put(
      'health_observation',
      healthObservation('outside', 'heart_rate', '2026-09-01T00:00:00Z'),
    );
    await f.records.delete('health_observation', 'outside');
    expect(await f.records.list('visit_question')).toHaveLength(1);
    await f.records.put('health_observation', {
      ...f.observation,
      concept: 'step_count',
    });
    expect(await f.records.list('visit_question')).toHaveLength(0);
    await f.records.delete('health_observation', f.observation.id);
    expect(
      (
        await f.database.execute(
          'SELECT question_id FROM visit_question_periods',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    f.close();
  }
});

test('a transcript correction invalidates derived health-period questions and cached reviewed memory', async () => {
  const f = await visitHealthFixture();
  const memory = await f.memory();
  try {
    await f.save({ memory });
    expect(
      await memory.recall('기간별 건강 기록', { minSimilarity: 0 }),
    ).toHaveLength(1);
    await f.database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'synthetic-transcript',
        'health_observation',
        f.observation.id,
        'old-segment',
        'new-segment',
        '2026-10-05T00:00:00Z',
      ],
    );
    expect(await f.records.list('visit_question')).toHaveLength(0);
    expect(
      await memory.recall('기간별 건강 기록', { minSimilarity: 0 }),
    ).toHaveLength(0);
  } finally {
    await memory.close();
    f.close();
  }
});
