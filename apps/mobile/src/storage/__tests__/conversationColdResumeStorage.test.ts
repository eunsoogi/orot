import { conversationWorkflowContinuationFixture as fixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationColdResumeStorage } from '../conversationColdResumeStorage';
import type { ConversationColdResumeDescriptor } from '../conversationColdResumeDescriptor';
import {
  continuationInput,
  continuationManifest,
} from '../conversationWorkflowContinuationIdentity';
import { createConversationWorkflowResumeStorage } from '../conversationWorkflowResumeStorage';

const identity = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
};
async function saved() {
  const f = await fixture();
  const store = createConversationColdResumeStorage(f.connection.database);
  const manifest = continuationManifest(
    identity,
    f.persisted.threadId,
    f.options,
  );
  const descriptor: ConversationColdResumeDescriptor = {
    version: 1,
    manifest,
    checkpointId: f.checkpoint.id,
    attempt: 0,
    sourceEpoch: await store.sourceEpoch(),
    request: f.options.request,
    submittedInput: null,
    exactInput: continuationInput(f.options),
    reconstruction: { taskVersion: 'synthetic-v1', batches: [], aliases: [] },
  };
  await createConversationWorkflowResumeStorage(
    f.connection.database,
    async () => {},
    async () => true,
  ).saveBoundary(
    manifest,
    {
      checkpointId: f.checkpoint.id,
      phase: 'task_response',
      pendingOperation: false,
      terminal: false,
    },
    0,
  );
  await store.save(descriptor);
  await f.requests.interruptRequest(
    'request',
    'session',
    0,
    'interrupted',
    'expired',
  );
  return { ...f, store, descriptor };
}

test('a new store opens exact protected data and only one fresh validator can claim the original turn', async () => {
  const f = await saved();
  try {
    const first = createConversationColdResumeStorage(f.connection.database);
    const second = createConversationColdResumeStorage(f.connection.database);
    expect(await first.open(identity)).toEqual(f.descriptor);
    const validate = jest.fn(async () => true);
    const results = await Promise.allSettled([
      first.claim(f.descriptor, new AbortController().signal, validate),
      second.claim(f.descriptor, new AbortController().signal, validate),
    ]);
    expect(
      results.filter(result => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await second.open(identity)).toBeUndefined();
    expect(
      (
        await f.connection.database.execute(
          'SELECT id, status FROM conversation_requests',
        )
      ).rows,
    ).toEqual([expect.objectContaining({ id: 'request', status: 'active' })]);
  } finally {
    f.connection.close();
  }
});

test.each([
  'source',
  'stop',
  'delete',
  'input',
  'checkpoint',
  'pending',
] as const)(
  '%s changes during reconstruction prevent activation or replay',
  async change => {
    const f = await saved();
    try {
      await expect(
        f.store.claim(f.descriptor, new AbortController().signal, async () => {
          const db = f.connection.database;
          if (change === 'source')
            await db.execute(
              'UPDATE conversation_journal_epoch SET value = value + 1',
            );
          if (change === 'stop')
            await f.requests.interruptRequest(
              'request',
              'session',
              0,
              'interrupted',
              'user-stopped',
            );
          if (change === 'delete') await f.requests.deleteSession('session');
          if (change === 'input')
            await db.execute(
              "UPDATE conversation_requests SET question = 'changed'",
            );
          if (change === 'checkpoint')
            await db.execute(
              "UPDATE langgraph_checkpoints SET checkpoint = X'00'",
            );
          if (change === 'pending')
            await db.execute(`INSERT INTO conversation_operation_journal
          (request_id, run_id, operation_id, status, revision) VALUES ('request','run','uncertain','pending',1)`);
          return true;
        }),
      ).rejects.toThrow();
      expect(await f.store.open(identity)).toBeUndefined();
    } finally {
      f.connection.close();
    }
  },
);

test('cancelled validation, changed descriptor and unsupported reconstruction do not claim', async () => {
  const f = await saved();
  try {
    const controller = new AbortController();
    await expect(
      f.store.claim(f.descriptor, controller.signal, async () => {
        controller.abort();
        return true;
      }),
    ).rejects.toThrow();
    await expect(
      f.store.claim(
        { ...f.descriptor, exactInput: 'changed' },
        new AbortController().signal,
        async () => true,
      ),
    ).rejects.toThrow();
    await expect(
      f.store.claim(
        f.descriptor,
        new AbortController().signal,
        async () => false,
      ),
    ).rejects.toThrow();
    expect(await f.store.open(identity)).toEqual(f.descriptor);
  } finally {
    f.connection.close();
  }
});

test('a real protected source update erases reconstruction data through the journal epoch', async () => {
  const f = await saved();
  try {
    await f.connection.database.execute(
      "INSERT INTO agent_memory_records (id, record_json) VALUES ('synthetic', '{}')",
    );
    await f.connection.database.execute(
      "UPDATE agent_memory_records SET record_json = '{\"changed\":true}' WHERE id = 'synthetic'",
    );
    expect(
      (
        await f.connection.database.execute(
          'SELECT * FROM conversation_cold_resumes',
        )
      ).rows,
    ).toEqual([]);
    expect(await f.store.open(identity)).toBeUndefined();
  } finally {
    f.connection.close();
  }
});

test('a source mutation after snapshot capture prevents a stale descriptor from being saved', async () => {
  const f = await saved();
  try {
    await f.connection.database.execute(
      "UPDATE conversation_requests SET status = 'active'",
    );
    await f.connection.database.execute(
      'UPDATE conversation_journal_epoch SET value = value + 1',
    );
    await expect(f.store.save(f.descriptor)).rejects.toThrow('unavailable');
  } finally {
    f.connection.close();
  }
});

test.each(['checkpoint', 'pending writes'])(
  'same-attempt save cannot adopt changed %s',
  async kind => {
    const f = await saved();
    try {
      await f.connection.database.execute(
        "UPDATE conversation_requests SET status = 'active'",
      );
      await f.store.save(f.descriptor);
      if (kind === 'checkpoint')
        await f.connection.database.execute(
          "UPDATE langgraph_checkpoints SET checkpoint = X'00'",
        );
      else
        await f.connection.database.execute(
          `INSERT INTO langgraph_checkpoint_writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
      VALUES (?, '', '0001', 'late-write', 0, 'synthetic', 'json', X'00')`,
          [f.persisted.threadId],
        );
      await expect(f.store.save(f.descriptor)).rejects.toThrow('immutable');
    } finally {
      f.connection.close();
    }
  },
);
