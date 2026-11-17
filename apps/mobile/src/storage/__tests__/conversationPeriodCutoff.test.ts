import { localQueryTimestampKey } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import type { HealthContextScope } from '../../healthEvidence/healthContext/scope';
import {
  appendConversationPeriod,
  ensureConversationPeriodCutoff,
} from '../conversationPeriodCutoff';

const early = '2026-10-05T00:00:00.000Z';
const later = '2026-10-05T00:00:00.000001Z';
const scope = (cutoff?: string): HealthContextScope => ({
  kind: 'health_context_period',
  version: 1,
  topic: 'measurements',
  window: {
    fromInclusive: '2026-10-01T00:00:00Z',
    toExclusive: early,
    timeZone: 'UTC',
    ...(cutoff === undefined ? {} : { dataAvailableThrough: cutoff }),
  },
});
const source = (cutoff?: string) => ({
  kind: 'health_context_period',
  scope: scope(cutoff),
});

/** Only synthetic metadata is persisted; SQLite, not a query mock, exercises migration and UPSERT. */
async function fixture() {
  const f = createHealthEvidenceTestDatabase();
  await f.database.execute(
    'CREATE TABLE conversation_artifacts (id TEXT PRIMARY KEY, result_json TEXT)',
  );
  await f.database.execute(`CREATE TABLE conversation_artifact_periods
    (artifact_id TEXT, topic TEXT, from_key TEXT, to_key TEXT,
    PRIMARY KEY (artifact_id, topic, from_key, to_key))`);
  return f;
}

async function legacy(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  sources: unknown,
) {
  const json =
    typeof sources === 'string' ? sources : JSON.stringify({ sources });
  await f.database.execute('INSERT INTO conversation_artifacts VALUES (?, ?)', [
    id,
    json,
  ]);
  await f.database.execute(
    'INSERT INTO conversation_artifact_periods VALUES (?, ?, ?, ?)',
    [
      id,
      'measurements',
      localQueryTimestampKey(scope().window.fromInclusive),
      localQueryTimestampKey(early),
    ],
  );
}

test.each([
  [[early, later, early], later],
  [[later, early], later],
  [[early, undefined, later], null],
  [[undefined, early], null],
] as const)(
  'merged save cutoffs preserve widest dependency %j',
  async (cutoffs, expected) => {
    const f = await fixture();
    try {
      await f.database.transaction(ensureConversationPeriodCutoff);
      for (const cutoff of cutoffs)
        await appendConversationPeriod(f.database, 'answer', scope(cutoff));
      const rows = await f.database.execute(
        'SELECT data_available_through_key FROM conversation_artifact_periods',
      );
      expect(rows.rows).toEqual([
        {
          data_available_through_key: expected
            ? localQueryTimestampKey(expected)
            : null,
        },
      ]);
    } finally {
      f.close();
    }
  },
);

test('legacy backfill preserves answers and conservative unknown dependencies, and is idempotent', async () => {
  const f = await fixture();
  try {
    await legacy(f, 'bounded', [source(early), source(later)]);
    await legacy(f, 'unbounded', [source(later), source()]);
    await legacy(f, 'invalid', [source(later), source('invalid')]);
    await legacy(f, 'malformed', '{invalid');
    await legacy(f, 'missing', []);
    const before = await f.database.execute(
      'SELECT * FROM conversation_artifacts ORDER BY id',
    );
    await f.database.transaction(ensureConversationPeriodCutoff);
    const result = await f.database.execute(
      'SELECT artifact_id, data_available_through_key FROM conversation_artifact_periods ORDER BY artifact_id',
    );
    expect(result.rows).toEqual([
      {
        artifact_id: 'bounded',
        data_available_through_key: localQueryTimestampKey(later),
      },
      ...['invalid', 'malformed', 'missing', 'unbounded'].map(artifact_id => ({
        artifact_id,
        data_available_through_key: null,
      })),
    ]);
    await f.database.transaction(ensureConversationPeriodCutoff);
    expect(
      await f.database.execute(
        'SELECT * FROM conversation_artifacts ORDER BY id',
      ),
    ).toEqual(before);
    expect(
      await f.database.execute(
        'SELECT artifact_id, data_available_through_key FROM conversation_artifact_periods ORDER BY artifact_id',
      ),
    ).toEqual(result);
  } finally {
    f.close();
  }
});

test('migration covers histories larger than a page without dropping artifacts', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 102; i++)
      await legacy(f, `answer-${i}`, [source(early)]);
    await f.database.transaction(ensureConversationPeriodCutoff);
    expect(
      (
        await f.database.execute(
          'SELECT count(*) AS total FROM conversation_artifact_periods WHERE data_available_through_key IS NOT NULL',
        )
      ).rows,
    ).toEqual([{ total: 102 }]);
    expect(
      (
        await f.database.execute(
          'SELECT count(*) AS total FROM conversation_artifacts',
        )
      ).rows,
    ).toEqual([{ total: 102 }]);
  } finally {
    f.close();
  }
});
