import { STORAGE_TABLES } from '@orot/storage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createSymptomSummaryStorage } from '../symptomSummaryStorage';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { setupUserStatementMemoryGuards } from '../userStatementMemoryGuards';

/** Compare the former sequential audit with the production batch on real SQLite.
 * Late restored rows deliberately bypass normal writers, not privacy checks. */
async function scenario(
  sequential: boolean,
  fail: boolean,
  recursive: boolean,
) {
  const f = await healthContextFixture();
  try {
    await f.database.execute(
      `PRAGMA recursive_triggers = ${recursive ? 'ON' : 'OFF'}`,
    );
    const memoryId = f.inside.id; // Same ID, different kind: deleting memory must preserve health source.
    await f.storage.list();
    const conversations = createConversationArtifactStorage(f.database);
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    await setupUserStatementMemoryGuards(f.database);
    const insert = async (id: string, complete = true) => {
      const saved = {
        ...f.saved,
        id,
        ...(complete ? {} : { inputLineage: undefined }),
      };
      await f.database.execute(
        'INSERT INTO symptom_summary_runs VALUES(?,?,?,?)',
        [id, saved.createdAt, saved.modelName, JSON.stringify(saved)],
      );
    };
    for (const id of ['orphan', 'child', 'memory-child', 'unrelated'])
      await insert(id);
    await insert('legacy', false);
    for (const row of [
      ['orphan', 'health_observation', 'missing'],
      ['child', 'generated_summary', 'orphan'],
      ['memory-child', 'reviewed_memory', memoryId],
      ['legacy', 'health_observation', 'missing'],
      ['unrelated', 'health_observation', f.inside.id],
    ])
      await f.database.execute(
        'INSERT INTO symptom_summary_sources VALUES(?,?,?)',
        row,
      );
    await f.database.execute(
      'INSERT INTO conversation_artifacts VALUES(?,?,?,?)',
      [
        'turn',
        'session',
        f.saved.createdAt,
        JSON.stringify({
          createdAt: f.saved.createdAt,
          status: 'complete',
          question: 'Synthetic user text',
        }),
      ],
    );
    await f.database.execute(
      'INSERT INTO conversation_artifact_sources VALUES(?,?,?)',
      ['turn', 'generated_summary', 'orphan'],
    );
    await f.database.execute('INSERT INTO agent_memory_records VALUES(?,?)', [
      memoryId,
      JSON.stringify({
        id: memoryId,
        text: `${f.saved.createdAt} 사용자가 직접 말한 내용 (당시의 진술이며 현재 상태나 의학적으로 확인된 사실이 아님):\nSynthetic user text`,
        meta: {
          provenance: {
            reviewState: 'user_stated',
            sourceReferences: [
              { kind: 'conversation_user_statement', id: 'turn' },
            ],
          },
        },
      }),
    ]);
    await f.database.execute('INSERT INTO daily_report_heads VALUES(?,?,?,?)', [
      'daily-orphan',
      'orphan',
      1,
      0,
    ]);
    const transaction = f.database.transaction.bind(f.database);
    let cleanup = 0;
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (sql, args = []) => {
          if (
            sql.startsWith('DELETE FROM symptom_summary_runs WHERE CASE') &&
            sql.includes('source.id = s.record_id')
          ) {
            expect(sql).toContain(' UNION ');
            if (sequential) {
              const tables = {
                ...Object.fromEntries(
                  Object.entries(STORAGE_TABLES).map(([kind, v]) => [
                    kind,
                    v.table,
                  ]),
                ),
                manual_history: 'manual_history_entries',
                reviewed_memory: 'agent_memory_records',
              };
              const prefix = sql.slice(0, sql.indexOf(' AND id IN ('));
              for (const [kind, table] of Object.entries(tables)) {
                cleanup++;
                await execute(
                  `${prefix} AND id IN (SELECT s.summary_id FROM symptom_summary_sources s WHERE s.record_kind = ? AND NOT EXISTS (SELECT 1 FROM ${table} source WHERE source.id = s.record_id))`,
                  [kind],
                );
              }
              return { rows: [] };
            }
            cleanup++;
          }
          const result = await execute(sql, args);
          if (
            fail &&
            sql.startsWith(
              'SELECT r.id, r.result_json FROM symptom_summary_runs',
            )
          )
            throw new Error('synthetic maintenance failure');
          return result;
        };
        await work(tx);
      });
    const store = createSymptomSummaryStorage(f.database);
    if (fail)
      await expect(store.list()).rejects.toThrow(
        'synthetic maintenance failure',
      );
    else await store.list();
    const rows = (
      await f.database.execute(
        'SELECT id FROM symptom_summary_runs ORDER BY id',
      )
    ).rows;
    const memory = (
      await f.database.execute(
        'SELECT id FROM agent_memory_records ORDER BY id',
      )
    ).rows;
    const turns = (
      await f.database.execute(
        'SELECT id FROM conversation_artifacts ORDER BY id',
      )
    ).rows;
    const policies = (
      await f.database.execute(
        'SELECT * FROM summary_period_policy ORDER BY summary_id',
      )
    ).rows;
    for (const id of ['orphan', 'child', 'memory-child'])
      expect(rows.some(row => row.id === id)).toBe(fail);
    expect(rows.some(row => row.id === 'legacy')).toBe(true);
    expect(rows.some(row => row.id === 'unrelated')).toBe(true);
    expect(memory.some(row => row.id === memoryId)).toBe(fail);
    expect(turns.some(row => row.id === 'turn')).toBe(fail);
    const sources = (
      await f.database.execute(
        'SELECT * FROM symptom_summary_sources ORDER BY summary_id,record_kind,record_id',
      )
    ).rows;
    const invalid = (
      await f.database.execute(
        'SELECT * FROM conversation_invalid_summaries ORDER BY id',
      )
    ).rows;
    const daily = (
      await f.database.execute(
        'SELECT * FROM daily_report_heads ORDER BY identity_key',
      )
    ).rows;
    expect(daily[0].deleted).toBe(fail ? 0 : 1);
    expect(daily[0].active_run_id).toBe(fail ? 'orphan' : null);
    return { rows, memory, turns, policies, sources, invalid, daily, cleanup };
  } finally {
    f.close();
  }
}

test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  'preserves cross-kind cascades and rollback=%s with recursive triggers=%s',
  async (fail, recursive) => {
    const baseline = await scenario(true, fail, recursive);
    const candidate = await scenario(false, fail, recursive);
    expect({ ...candidate, cleanup: undefined }).toEqual({
      ...baseline,
      cleanup: undefined,
    });
    expect(baseline.cleanup).toBe(15);
    expect(candidate.cleanup).toBe(1);
  },
);
