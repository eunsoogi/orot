import { NativeModules } from 'react-native';
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
import { continuedActionRecoveryFixture } from '../testSupport/continuedActionRecoveryFixture';
import { expectCommittedHistoryMarker } from '../testSupport/committedHistorySaveSpy';

// Each synthetic cut preserves only committed domain writes. New native nonces
// model different processes without claiming a physical OS crash was exercised.
test('a recovered action can save a distinct new source and recover that new commit once', async () => {
  const previous = NativeModules.ConversationExecutionModule;
  NativeModules.ConversationExecutionModule = {
    processIdentity: async () => '11111111-1111-4111-8111-111111111111',
  };
  const f = await continuedActionRecoveryFixture();
  try {
    f.plan([f.question]);
    expect((await f.live()).status).toBe('result');
    expect(f.save).toHaveBeenCalledTimes(1);
    await f.crash();
    NativeModules.ConversationExecutionModule = {
      processIdentity: async () => '22222222-2222-4222-8222-222222222222',
    };
    const first = jest.fn(async () => true);
    f.plan([f.prior[0].question]);
    expect((await f.recover(first)).status).toBe('result');
    expect(first).toHaveBeenCalledTimes(2);
    expect(f.save).toHaveBeenCalledTimes(2);
    await expectCommittedHistoryMarker(f.db.database, 'tool-2');
    expect(
      (
        await f.db.database.execute(
          'SELECT * FROM conversation_action_recovery_claims',
        )
      ).rows,
    ).toHaveLength(0);
    await f.crash();
    expect(await f.open()).toBeUndefined();
    NativeModules.ConversationExecutionModule = {
      processIdentity: async () => '33333333-3333-4333-8333-333333333333',
    };
    const second = jest.fn(async () => true);
    f.plan([]);
    expect((await f.recover(second)).status).toBe('result');
    expect(second).toHaveBeenCalledTimes(2);
    expect(f.save).toHaveBeenCalledTimes(2);
    expect(
      (await f.db.database.execute('SELECT id FROM manual_history_entries'))
        .rows,
    ).toHaveLength(2);
    expect(await f.open()).toBeUndefined();
    await expect(f.recover()).rejects.toThrow();
    expect(f.save).toHaveBeenCalledTimes(2);
  } finally {
    NativeModules.ConversationExecutionModule = previous;
    f.db.close();
  }
});

test.each(['deny', 'stop'] as const)(
  'fresh subsequent action respects %s without another write',
  async mode => {
    const previous = NativeModules.ConversationExecutionModule;
    NativeModules.ConversationExecutionModule = {
      processIdentity: async () => '11111111-1111-4111-8111-111111111111',
    };
    const f = await continuedActionRecoveryFixture();
    try {
      f.plan([f.question]);
      expect((await f.live()).status).toBe('result');
      await f.crash();
      NativeModules.ConversationExecutionModule = {
        processIdentity: async () => '22222222-2222-4222-8222-222222222222',
      };
      const controller = new AbortController();
      let approvals = 0;
      const consent = jest.fn(async () => {
        if (++approvals === 1) return true;
        if (mode === 'stop') controller.abort();
        return mode === 'stop';
      });
      f.plan([f.prior[0].question]);
      const result = await f.recover(consent, controller.signal);
      expect(result.status).toBe(
        mode === 'deny' ? 'consent_required' : 'cancelled',
      );
      expect(consent).toHaveBeenCalledTimes(2);
      expect(f.save).toHaveBeenCalledTimes(1);
      expect(
        (await f.db.database.execute('SELECT id FROM manual_history_entries'))
          .rows,
      ).toHaveLength(1);
      expect(await f.open()).toBeUndefined();
    } finally {
      NativeModules.ConversationExecutionModule = previous;
      f.db.close();
    }
  },
);
