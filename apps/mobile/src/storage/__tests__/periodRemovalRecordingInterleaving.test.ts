import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../diseaseHypotheses/savedSummaries';
import { RetainedSourceInvalidError } from '../../aiFeatures/integration/retainedSourceError';
import { setupVisitQuestionPeriods } from '../visitQuestionPeriods';
import { assertPeriodNotRemoved } from '../conversationPeriodRemoval';

test('rebuilds a restored recording index and sees a removal committed between the original period reads', async () => {
  const fixture = await healthContextFixture();
  const { database, saved, inside } = fixture;
  const source = saved.sources.find(isPeriodSummarySource)!;
  try {
    // Supported backups retain user_version but can be missing an expendable index.
    await database.execute('DROP INDEX transcript_segments_recording_idx');
    expect(
      (
        await database.execute(
          "SELECT name FROM sqlite_master WHERE name='transcript_segments_recording_idx'",
        )
      ).rows,
    ).toHaveLength(0);
    // The shared secure database bootstraps before exposing Research or Memory.
    await database.transaction(setupVisitQuestionPeriods);
    await assertPeriodNotRemoved(database, source);
    let statements = 0;
    let removed = false;
    await database.transaction(async tx => {
      // Match the strict reader: a typed invalid source returns unavailable,
      // not rollback of unrelated deletion on the very same connection.
      try {
        await assertPeriodNotRemoved(
          {
            async execute(sql, bindings) {
              const result = await tx.execute(sql, bindings);
              if (++statements === 1) {
                expect(sql).toContain(
                  'SELECT source_id FROM source_deletion_tombstones',
                );
                await database.execute(
                  'INSERT INTO agent_memory_removed_sources(source_id) VALUES (?)',
                  [inside.id],
                );
              }
              return result;
            },
          },
          source,
        );
      } catch (error) {
        if (!(error instanceof RetainedSourceInvalidError)) throw error;
        removed = true;
      }
    });
    expect(removed).toBe(true);
    // Measurements visit first marker's point/workout, then second marker's point.
    expect(statements).toBe(3);
    expect(
      (
        await database.execute(
          'SELECT source_id FROM agent_memory_removed_sources WHERE source_id=?',
          [inside.id],
        )
      ).rows,
    ).toHaveLength(1);
  } finally {
    fixture.close();
  }
});
