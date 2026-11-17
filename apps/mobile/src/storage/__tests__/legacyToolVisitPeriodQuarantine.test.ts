import { restoreVisitQuestionPeriodForHistory } from '../../aiFeatures/integration/savedVisitQuestionHealthContext';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { periodContributorFixture } from '../testSupport/periodContributorFixture';
test('legacy tool and visit periods reject unverifiable deleted contributors without deleting tool snapshots', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const snapshots = await Promise.all(
      ['conversation_tool_events', 'conversation_tool_lineage'].map(
        async table => ({
          table,
          rows: (await f.database.execute(`SELECT * FROM ${table}`)).rows,
        }),
      ),
    );
    await f.repository.delete('health_observation', 'candidate');
    for (const { table, rows } of snapshots)
      for (const row of rows) {
        const keys = Object.keys(row);
        await f.database.execute(
          `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          keys.map(k => row[k]!),
        );
      }
    await f.database.execute('DELETE FROM tool_period_policy');
    expect(await f.conversation.readToolTurns('session')).toHaveLength(0);
    expect(
      await f.conversation.readUnavailableToolMetadata('session'),
    ).toHaveLength(1);
    expect(
      (
        await f.database.execute(
          'SELECT event_json FROM conversation_tool_events',
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      restoreVisitQuestionPeriodForHistory(
        {
          scope: f.source.scope,
          revision: f.source.revision,
          deletionGeneration: f.source.deletionGeneration,
        },
        f.read,
        new LocalEvidenceReferenceRegistry(),
      ),
    ).rejects.toThrow();
    await f.repository.delete('health_observation', 'duplicate');
    expect(
      (
        await f.database.execute(
          'SELECT event_json FROM conversation_tool_events',
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    f.close();
  }
});

test('tool regeneration uses a new identity and current captures survive unrelated deletion', async () => {
  const f = await periodContributorFixture(
    'workout_duration',
    'measurements',
    true,
    true,
  );
  try {
    const row = (
      await f.database.execute('SELECT * FROM conversation_tool_events')
    ).rows[0]!;
    const lineage = (
      await f.database.execute(
        'SELECT sources_json FROM conversation_tool_lineage',
      )
    ).rows[0]!;
    const event = JSON.parse(String(row.event_json));
    const sources = JSON.parse(String(lineage.sources_json));
    await f.repository.delete('health_observation', 'candidate');
    await f.database.execute(
      'INSERT INTO conversation_tool_events (session_id,message_id,created_at,run_id,call_id,event_json) VALUES (?,?,?,?,?,?)',
      [
        row.session_id!,
        row.message_id!,
        row.created_at!,
        row.run_id!,
        row.call_id!,
        row.event_json!,
      ],
    );
    await f.database.execute(
      'INSERT INTO conversation_tool_lineage (session_id,run_id,call_id,sources_json) VALUES (?,?,?,?)',
      [row.session_id!, row.run_id!, row.call_id!, lineage.sources_json!],
    );
    await f.database.execute('DELETE FROM tool_period_policy');
    expect(await f.conversation.readToolTurns('session')).toEqual([]);
    const current = await f.read(f.window, ['measurements']);
    const fresh = sources.map((source: typeof f.source) => ({
      ...source,
      deletionGeneration: current.deletionGeneration,
    }));
    await f.conversation.appendToolEvent({
      sessionId: 'session',
      messageId: 'fresh-turn',
      createdAt: String(row.created_at),
      sessionVersion: 0,
      event: { ...event, operationRunId: 'fresh-run', callId: 'fresh-call' },
      dependencies: fresh,
    });
    await f.repository.put('health_observation', {
      ...f.candidate,
      id: 'outside',
      effectiveAt: '2026-08-01T00:00:00Z',
      endedAt: undefined,
    });
    await f.repository.delete('health_observation', 'outside');
    expect(
      (await f.conversation.readToolTurns('session')).map(
        turn => turn.messageId,
      ),
    ).toEqual(['fresh-turn']);
    expect(
      await f.conversation.readUnavailableToolMetadata('session'),
    ).toHaveLength(1);
    await f.conversation.deleteSession('session');
    expect(await f.conversation.readUnavailableToolMetadata('session')).toEqual(
      [],
    );
  } finally {
    f.close();
  }
});
