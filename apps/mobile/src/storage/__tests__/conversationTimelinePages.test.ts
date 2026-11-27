import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('real SQLite keyset reads only ten metadata rows and reaches all equal-timestamp turns without deletion', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('timeline', await storage.currentGeneration());
    for (let index = 0; index < 25; index++) {
      await storage.append({
        id: `turn-${String(index).padStart(2, '0')}`,
        sessionId: 'timeline',
        createdAt: '2026-11-01T00:00:00.000Z',
        providerId: 'synthetic',
        modelId: 'synthetic',
        status: 'complete',
        question: 'synthetic private question',
        answer: 'synthetic private answer',
        sources: f.saved.sources,
        citations: [f.saved.sources[0]!.reference],
      });
    }
    const first = await storage.listTimeline('timeline', 0);
    expect(first.items).toHaveLength(10);
    expect(JSON.stringify(first)).not.toContain('private');
    const second = await storage.listTimeline('timeline', 0, first.nextCursor!);
    const third = await storage.listTimeline('timeline', 0, second.nextCursor!);
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(item => item.id),
      ).size,
    ).toBe(25);
    const selected = await storage.list(
      'timeline',
      undefined,
      50,
      'conversation',
      first.items.map(item => item.id),
    );
    expect(selected.items).toHaveLength(10);
    expect((await storage.list('timeline')).items).toHaveLength(25);
    const hidden = await storage.hideSession('timeline');
    await expect(
      storage.listTimeline('timeline', 0, first.nextCursor!),
    ).rejects.toThrow();
    const version = await storage.undoHiddenSession('timeline', hidden!);
    await expect(
      storage.listTimeline('timeline', version!, first.nextCursor!),
    ).rejects.toThrow();
    await f.repository.deleteAllLocalData();
    await expect(storage.listTimeline('timeline', version!)).rejects.toThrow();
  } finally {
    f.close();
  }
});

test('timeline includes tool-only, interrupted and task entries while selected reads never parse unrelated bodies', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('mixed', await storage.currentGeneration());
    const time = '2026-11-01T00:00:00.000Z';
    await f.database.execute(
      'INSERT INTO conversation_tool_events VALUES (?, ?, ?, ?, ?, ?)',
      ['mixed', 'tool-only', time, 'run', 'call', 'invalid unselected body'],
    );
    await f.database.execute(
      "INSERT INTO conversation_requests (id, session_id, session_version, question, created_at, status) VALUES (?, ?, ?, ?, ?, 'interrupted')",
      ['interrupted', 'mixed', 0, 'synthetic question', time],
    );
    await f.database.execute(
      'INSERT INTO conversation_task_cards (session_id, id, created_at, revision, task_json) VALUES (?, ?, ?, ?, ?)',
      ['mixed', 'task', time, 1, 'invalid unselected task'],
    );
    const page = await storage.listTimeline('mixed', 0);
    expect(page.items.map(item => `${item.kind}:${item.id}`).sort()).toEqual([
      'task:task',
      'turn:interrupted',
      'turn:tool-only',
    ]);
    expect(await storage.readToolTurns('mixed', 0, [])).toEqual([]);
    expect(await storage.readTaskCards('mixed', 0, [])).toEqual([]);
    expect(
      await storage.listInterruptedRequests('mixed', 0, ['absent']),
    ).toEqual([]);
    await expect(
      storage.readToolTurns('mixed', 0, ['tool-only']),
    ).rejects.toThrow();
    await expect(storage.readTaskCards('mixed', 0, ['task'])).rejects.toThrow();
    expect(
      (await storage.listInterruptedRequests('mixed', 0, ['interrupted']))[0]
        ?.question,
    ).toBe('synthetic question');
  } finally {
    f.close();
  }
});

test.each([false, true])(
  'classifies legacy treatment and malformed artifact metadata once without changing cursor precedence (%s)',
  async displayOnly => {
    const f = await healthContextFixture();
    try {
      const classify = jest.fn();
      const database: typeof f.database = {
        ...f.database,
        transaction: work =>
          f.database.transaction(tx =>
            work({
              ...tx,
              async execute(sql, bindings) {
                if (sql.includes('ROW_NUMBER() OVER (PARTITION BY id, kind')) {
                  const plan = await tx.execute(`EXPLAIN ${sql}`, bindings);
                  classify(
                    plan.rows.filter(
                      row =>
                        row.opcode === 'Function' && row.p4 === 'json_type(2)',
                    ).length,
                  );
                }
                return tx.execute(sql, bindings);
              },
            }),
          ),
      };
      const storage = createConversationArtifactStorage(database);
      const owner = 'classification';
      await storage.createSession(owner, await storage.currentGeneration());
      const old = '2026-11-01T00:00:00.000Z';
      const newTime = '2026-11-02T00:00:00.000Z';
      for (const [id, body] of [
        ['legacy-treatment', '{"treatmentContext":null}'],
        ['uncollided-treatment', '{"treatmentContext":{}}'],
        ['malformed', '{broken'],
        ['ordinary', '{}'],
      ])
        await f.database.execute(
          'INSERT INTO conversation_artifacts VALUES (?, ?, ?, ?)',
          [id!, owner, old, body!],
        );
      await f.database.execute(
        'INSERT INTO conversation_tool_events VALUES (?, ?, ?, ?, ?, ?)',
        [owner, 'ordinary', newTime, 'run', 'call', '{}'],
      );
      await f.database.execute(
        'INSERT INTO conversation_task_cards (session_id, id, created_at, revision, task_json) VALUES (?, ?, ?, ?, ?)',
        [owner, 'treatment:legacy-treatment', newTime, 1, '{}'],
      );
      const first = await storage.listTimeline(
        owner,
        0,
        undefined,
        2,
        displayOnly,
      );
      const second = await storage.listTimeline(
        owner,
        0,
        first.nextCursor!,
        2,
        displayOnly,
      );
      expect([...first.items, ...second.items]).toEqual([
        {
          id: 'treatment:legacy-treatment',
          kind: 'task',
          createdAt: newTime,
          version: 0,
        },
        { id: 'ordinary', kind: 'turn', createdAt: newTime, version: 0 },
        {
          id: 'treatment:uncollided-treatment',
          kind: 'task',
          createdAt: old,
          version: 0,
        },
        { id: 'malformed', kind: 'turn', createdAt: old, version: 0 },
      ]);
      expect(second.nextCursor).toBeNull();
      expect(classify.mock.calls).toEqual([[1], [1]]);
    } finally {
      f.close();
    }
  },
);
