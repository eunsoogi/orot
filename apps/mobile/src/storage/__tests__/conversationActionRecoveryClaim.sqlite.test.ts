import { NativeModules } from 'react-native';
import { readConversationProcessIdentity } from '../../ragConversation/conversationProcessIdentity';
import { conversationActionRecoveryFixture } from '../testSupport/conversationActionRecoveryFixture';
import { saveConversationHealthHistory } from '../conversationHealthHistory';
import { createConversationActionRecoveryClaim } from '../conversationActionRecoveryClaim';

const signal = new AbortController().signal;
const previous = NativeModules.ConversationExecutionModule;
afterEach(() => {
  NativeModules.ConversationExecutionModule = previous;
});
async function fixture(owner = { attempt: 0, claimed: 0 as 0 | 1 }) {
  const f = await conversationActionRecoveryFixture(owner);
  await saveConversationHealthHistory(f.db, f.input, signal);
  const store = createConversationActionRecoveryClaim(f.db);
  NativeModules.ConversationExecutionModule = {
    processIdentity: async () => '22222222-2222-4222-8222-222222222222',
  };
  const current = (await readConversationProcessIdentity(signal))!;
  return { ...f, store, current };
}

// Real SQLite, synthetic native identities. No claim about actual process death or iOS execution.
test.each(['active', 'interrupted'] as const)(
  'only a verified different process claims the %s owner once',
  async status => {
    const f = await fixture();
    try {
      if (status === 'interrupted')
        await f.requests.interruptRequest(
          'request',
          'session',
          0,
          'interrupted',
          'expired',
        );
      const descriptor = await f.store.open(
        f.stage.manifest,
        f.current,
        signal,
      );
      expect(descriptor?.entryId).toBe('conversation-history:request');
      const attempts = await Promise.allSettled([
        f.store.claim(descriptor!, f.current, signal, async () => true),
        f.store.claim(descriptor!, f.current, signal, async () => true),
      ]);
      expect(attempts.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(
        (
          await f.db.execute(
            'SELECT attempt, claimed FROM conversation_workflow_resumes',
          )
        ).rows,
      ).toEqual([{ attempt: 1, claimed: 1 }]);
      expect(
        (await f.db.execute('SELECT status FROM conversation_requests')).rows[0]
          .status,
      ).toBe('active');
      expect(
        await f.store.open(f.stage.manifest, f.current, signal),
      ).toBeUndefined();
      expect(
        (await f.db.execute('SELECT id FROM manual_history_entries')).rows,
      ).toHaveLength(1);
    } finally {
      f.connection.close();
    }
  },
);

test('same native process and forged tokens cannot take over even an interrupted owner', async () => {
  const f = await fixture();
  try {
    NativeModules.ConversationExecutionModule = {
      processIdentity: async () => f.stage.ownerProcessId,
    };
    const same = (await readConversationProcessIdentity(signal))!;
    expect(await f.store.open(f.stage.manifest, same, signal)).toBeUndefined();
    expect(
      await f.store.open(f.stage.manifest, { ...f.current }, signal),
    ).toBeUndefined();
    expect(
      (
        await f.db.execute(
          'SELECT attempt, claimed FROM conversation_workflow_resumes',
        )
      ).rows,
    ).toEqual([{ attempt: 0, claimed: 0 }]);
  } finally {
    f.connection.close();
  }
});

test.each(['source', 'checkpoint', 'input', 'stop'] as const)(
  'changes during async validation prevent claim: %s',
  async mode => {
    const f = await fixture();
    try {
      const descriptor = await f.store.open(
        f.stage.manifest,
        f.current,
        signal,
      );
      await expect(
        f.store.claim(descriptor!, f.current, signal, async () => {
          if (mode === 'source')
            await f.db.execute(
              "UPDATE manual_history_entries SET details = 'Changed synthetic source'",
            );
          if (mode === 'checkpoint')
            await f.db.execute(
              "UPDATE langgraph_checkpoints SET metadata = X'00'",
            );
          if (mode === 'input')
            await f.db.execute(
              "UPDATE conversation_requests SET input_json = '{}' ",
            );
          if (mode === 'stop')
            await f.requests.interruptRequest(
              'request',
              'session',
              0,
              'interrupted',
              'user-stopped',
            );
          return true;
        }),
      ).rejects.toThrow();
      expect(
        (
          await f.db.execute(
            'SELECT * FROM conversation_action_recovery_claims',
          )
        ).rows,
      ).toHaveLength(0);
    } finally {
      f.connection.close();
    }
  },
);

test('claim failure after its CAS rolls back request activation and attempt together', async () => {
  const f = await fixture();
  try {
    const descriptor = await f.store.open(f.stage.manifest, f.current, signal);
    await f.db.execute(
      "CREATE TRIGGER fail_claim BEFORE INSERT ON conversation_action_recovery_claims BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    await expect(
      f.store.claim(descriptor!, f.current, signal, async () => true),
    ).rejects.toThrow();
    expect(
      (
        await f.db.execute(
          'SELECT attempt, claimed FROM conversation_workflow_resumes',
        )
      ).rows,
    ).toEqual([{ attempt: 0, claimed: 0 }]);
  } finally {
    f.connection.close();
  }
});

test('a proven dead process claim is replaced at exactly the next attempt, never by elapsed time', async () => {
  const f = await fixture({ attempt: 3, claimed: 1 });
  try {
    const descriptor = await f.store.open(f.stage.manifest, f.current, signal);
    const claim = await f.store.claim(
      descriptor!,
      f.current,
      signal,
      async () => true,
    );
    expect(claim.attempt).toBe(4);
    expect(
      (
        await f.db.execute(
          'SELECT attempt, claimed FROM conversation_workflow_resumes',
        )
      ).rows,
    ).toEqual([{ attempt: 4, claimed: 1 }]);
    expect(
      await f.store.open(f.stage.manifest, f.current, signal),
    ).toBeUndefined();
  } finally {
    f.connection.close();
  }
});
