import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { isGeneratedSummarySource } from '../../conversationTools/conversationArtifactSources';
import { assertConversationSummaryParent } from '../conversationSummaryParent';
import { RetainedSourceInvalidError } from '../../aiFeatures/integration/retainedSourceError';

test('a strict summary edge reads the retained row and invalidation fence in one SQLite statement', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const artifact = await f.storage.read('older');
    const source = artifact?.sources.find(isGeneratedSummarySource);
    if (!source) throw new Error('Missing synthetic summary edge');
    const reads: string[] = [];
    const validate = () =>
      f.database.transaction(tx =>
        assertConversationSummaryParent(
          {
            ...tx,
            async execute(sql, bindings) {
              if (
                /FROM (?:conversation_invalid_summaries|symptom_summary_runs)/.test(
                  sql,
                )
              )
                reads.push(sql);
              return tx.execute(sql, bindings);
            },
          },
          f.database,
          source,
        ),
      );
    await validate();
    expect(reads).toHaveLength(1);

    // It must still reprove a real committed policy change on a later read.
    await f.quarantine();
    await expect(validate()).rejects.toBeInstanceOf(RetainedSourceInvalidError);
    expect(reads).toHaveLength(2);

    // A separately committed logical invalidation must not expose the saved row.
    await f.database.execute(
      "UPDATE summary_period_policy SET status='current' WHERE summary_id=?",
      [source.id],
    );
    await f.database.execute(
      'INSERT OR IGNORE INTO conversation_invalid_summaries (id) VALUES (?)',
      [source.id],
    );
    await expect(validate()).rejects.toThrow(
      'The generated summary changed or was removed.',
    );
    expect(reads).toHaveLength(3);
  } finally {
    f.close();
  }
});
