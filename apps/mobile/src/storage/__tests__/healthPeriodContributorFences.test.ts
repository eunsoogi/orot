import { periodContributorFixture } from '../testSupport/periodContributorFixture';
import {
  assertHealthPeriodCurrent,
  listInvalidatedHealthPeriods,
} from '../healthPeriodDependencies';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';
import { setupConversationArtifactSchema } from '../conversationArtifactSchema';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { setupVisitQuestionPeriods } from '../visitQuestionPeriods';

const scenarios = [
  ['blood_glucose', 'measurements'],
  ['body_temperature', 'measurements'],
  ['workout_duration', 'activity'],
] as const;
test.each(scenarios)(
  'deleting %s immediately removes derived artifacts and fences the exact period',
  async (concept, topic) => {
    const f = await periodContributorFixture(concept, topic);
    try {
      expect(f.report.quantities).toHaveLength(1);
      await f.repository.delete('health_observation', 'candidate');
      expect(await f.summary.read('saved')).toBeNull();
      expect(await f.conversation.read('turn')).toBeNull();
      expect(await f.conversation.readToolTurns('session')).toEqual([]);
      expect(await f.research.read(1)).toBeNull();
      expect(await listInvalidatedHealthPeriods(f.database)).toHaveLength(1);
      await expect(
        assertHealthPeriodCurrent(f.database, f.source),
      ).rejects.toThrow();
    } finally {
      f.close();
    }
  },
);

test.each(['move', 'stale', 'logical', 'memory logical'] as const)(
  '%s invalidation also covers arbitrary measurement periods',
  async event => {
    const f = await periodContributorFixture('blood_glucose', 'measurements');
    try {
      if (event === 'move')
        await f.repository.put('health_observation', {
          ...f.candidate,
          effectiveAt: '2026-09-01T00:00:00Z',
        });
      else if (event === 'stale')
        await f.database.execute(
          'INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES (?,?,?,?,?,?)',
          [
            't',
            'health_observation',
            'candidate',
            'old',
            'new',
            '2026-10-06T00:00:00Z',
          ],
        );
      else
        await f.database.execute(
          `INSERT INTO ${event === 'logical' ? 'source_deletion_tombstones' : 'agent_memory_removed_sources'}(source_id) VALUES (?)`,
          ['candidate'],
        );
      expect(await f.conversation.read('turn')).toBeNull();
      expect(await f.conversation.readToolTurns('session')).toEqual([]);
      expect(await f.research.read(1)).toBeNull();
      if (event === 'logical' || event === 'memory logical') {
        expect(await f.summary.read('saved')).toBeNull();
        expect(await listInvalidatedHealthPeriods(f.database)).toHaveLength(1);
        await expect(
          assertPeriodNotRemoved(f.database, f.source),
        ).rejects.toThrow('removed');
      }
    } finally {
      f.close();
    }
  },
);

test('workouts starting before a measurement window still fence the derived heart-rate context', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
  );
  try {
    const before = JSON.stringify(f.report.quantities);
    await f.repository.delete('health_observation', 'candidate');
    expect(
      JSON.stringify((await f.read(f.window, ['measurements'])).quantities),
    ).not.toBe(before);
    expect(await f.summary.read('saved')).toBeNull();
    expect(await f.conversation.read('turn')).toBeNull();
    expect(await listInvalidatedHealthPeriods(f.database)).toHaveLength(1);
  } finally {
    f.close();
  }
});

test('reopening an existing schema replaces every obsolete period-trigger family', async () => {
  const f = await periodContributorFixture('blood_glucose', 'measurements');
  try {
    const names = [
      'conversation_period_removed_health_observations',
      'tool_period_health_observations_delete',
      'research_period_stale_health_observations_insert',
      'summary_parent_period_added_health_observations',
      'summary_period_deleted_health_observations',
      'visit_question_period_deleted_health_observations',
    ];
    for (const name of names) {
      await f.database.execute(`DROP TRIGGER ${name}`);
      await f.database.execute(
        `CREATE TRIGGER ${name} AFTER DELETE ON health_observations BEGIN SELECT 'obsolete-period-policy'; END`,
      );
    }
    await f.database.transaction(setupConversationArtifactSchema);
    await createSymptomSummaryStorage(f.database).list();
    await setupVisitQuestionPeriods(f.database);
    for (const name of names) {
      const row = (
        await f.database.execute(
          'SELECT sql FROM sqlite_master WHERE type=? AND name=?',
          ['trigger', name],
        )
      ).rows[0];
      expect(row?.sql).not.toContain('obsolete-period-policy');
      expect(row?.sql).toContain('observationKind');
    }
    await f.repository.delete('health_observation', 'candidate');
    expect(await f.summary.read('saved')).toBeNull();
    expect(await f.conversation.read('turn')).toBeNull();
    expect(await f.research.read(1)).toBeNull();
    expect(await f.conversation.readToolTurns('session')).toEqual([]);
    expect(await listInvalidatedHealthPeriods(f.database)).toHaveLength(1);
  } finally {
    f.close();
  }
});

test('an existing logical marker rejects a freshly captured period in a new session, independently of generation fencing', async () => {
  const f = await periodContributorFixture('blood_glucose', 'measurements');
  try {
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones(source_id) VALUES (?)',
      ['candidate'],
    );
    const current = await f.read(f.window, ['measurements']);
    const fresh = {
      ...f.source,
      deletionGeneration: current.deletionGeneration,
    };
    // The row remains and its statistics have not changed; reaggregation alone is insufficient.
    await expect(
      assertHealthPeriodCurrent(f.database, fresh),
    ).resolves.toBeUndefined();
    await f.conversation.createSession(
      'fresh',
      await f.conversation.currentGeneration(),
    );
    await expect(
      f.conversation.append({
        id: 'late',
        sessionId: 'fresh',
        createdAt: '2026-10-06T00:00:00.000Z',
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        question: 'Synthetic',
        answer: 'Synthetic',
        sources: [fresh],
      }),
    ).rejects.toThrow('period source was removed');
  } finally {
    f.close();
  }
});

test('exact-case workout context guards do not turn an uppercase unrelated concept into an interval contributor', async () => {
  const f = await periodContributorFixture('blood_glucose', 'measurements');
  try {
    await f.repository.put('health_observation', {
      ...f.candidate,
      id: 'other',
      concept: 'WORKOUT_DURATION',
      observationKind: 'other',
      effectiveAt: '2026-09-30T23:00:00Z',
      endedAt: '2026-10-02T00:00:00Z',
    });
    await f.repository.delete('health_observation', 'other');
    expect(await f.conversation.read('turn')).not.toBeNull();
    expect(await f.summary.read('saved')).not.toBeNull();
  } finally {
    f.close();
  }
});
