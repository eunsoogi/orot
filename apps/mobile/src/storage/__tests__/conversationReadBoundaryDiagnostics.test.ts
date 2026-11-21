import { createConversationReadDiagnostics } from '../conversationReadDiagnostics';
import * as diagnostics from '../../providers/diagnostics';
import * as history from '../../providers/conversationHistoryDiagnostic';
import { sharedAncestryProfileFixture } from '../../aiFeatures/integration/testSupport/sharedAncestryProfileFixture';

const boundaries = [
  'artifact_read_setup',
  'artifact_read_admission',
  'artifact_read_settlement',
  'artifact_session_lease',
  'artifact_root_row',
  'artifact_root_decode',
  'artifact_parent_row',
  'artifact_retained_source',
  'artifact_summary_parent',
];

/** Real protected reads still traverse summary, retained and conversation parents;
 * instrumentation records closed boundaries without substituting any authority. */
test('protected session reads emit balanced fixed spans only for opted-in history operations', async () => {
  const f = await sharedAncestryProfileFixture(2, true);
  const emit = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation(() => {});
  const enabled = jest
    .spyOn(history, 'historyValidationCostEnabled')
    .mockReturnValue(true);
  try {
    const template = (await f.storage.read('dag-turn-0'))!;
    await f.storage.append({
      ...template,
      id: 'direct-period',
      sources: f.saved.sources,
      citations: f.saved.sources.map(source => source.reference),
    });
    const version = await f.storage.activeSessionVersion('session');
    if (version === null) throw new Error('Missing synthetic session');
    const ids = ['dag-turn-0', 'dag-turn-1', 'direct-period'];
    const expected = await f.storage.readSessionMany('session', version, ids);
    expect(expected.every(Boolean)).toBe(true);
    for (const historyPage of [false, true]) {
      emit.mockClear();
      const operation = f.storage.beginReadOperation(undefined, {
        historyPage,
      });
      expect(operation).toBeDefined();
      try {
        expect(
          await operation!.readSessionMany('session', version, ids),
        ).toEqual(expected);
        for (const stage of boundaries) {
          const events = emit.mock.calls.filter(call => call[1] === stage);
          if (!historyPage) expect(events).toEqual([]);
          else {
            expect({ stage, observed: events.length > 0 }).toEqual({
              stage,
              observed: true,
            });
            expect(events.filter(call => call[2] === 'started').length).toBe(
              events.filter(call => call[2] === 'completed').length,
            );
            expect(
              events.every(call => call.length === 3 && call[0] === 'rag'),
            ).toBe(true);
          }
        }
      } finally {
        operation!.dispose();
      }
    }
    emit.mockImplementation(() => {
      throw new Error('optional sink unavailable');
    });
    const operation = f.storage.beginReadOperation(undefined, {
      historyPage: true,
    });
    try {
      expect(await operation!.readSessionMany('session', version, ids)).toEqual(
        expected,
      );
    } finally {
      operation!.dispose();
    }
    await f.repository.delete('health_observation', f.inside.id);
    expect(await f.storage.read('dag-turn-1')).toBeNull();
  } finally {
    emit.mockRestore();
    enabled.mockRestore();
    f.close();
  }
});

test('a root query failure keeps the original error identity and fixed failed span', async () => {
  const f = await sharedAncestryProfileFixture(1, false);
  const emit = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation(() => {});
  const enabled = jest
    .spyOn(history, 'historyValidationCostEnabled')
    .mockReturnValue(true);
  const transaction = f.database.transaction.bind(f.database);
  const error = new Error('synthetic private SQL failure');
  try {
    const version = await f.storage.activeSessionVersion('session');
    if (version === null) throw new Error('Missing synthetic session');
    f.database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (...args) => {
          if (
            args[0].startsWith(
              'SELECT a.id, a.session_id, a.created_at, a.result_json',
            )
          )
            return Promise.reject(error);
          return execute(...args);
        };
        try {
          await work(tx);
        } finally {
          tx.execute = execute;
        }
      });
    const operation = f.storage.beginReadOperation(undefined, {
      historyPage: true,
    });
    try {
      await expect(
        operation!.readSessionMany('session', version, ['turn-0']),
      ).rejects.toBe(error);
      expect(
        emit.mock.calls.filter(call => call[1] === 'artifact_root_row'),
      ).toEqual([
        ['rag', 'artifact_root_row', 'started'],
        ['rag', 'artifact_root_row', 'failed'],
      ]);
      expect(JSON.stringify(emit.mock.calls)).not.toContain(error.message);
    } finally {
      operation!.dispose();
    }
  } finally {
    f.database.transaction = transaction;
    emit.mockRestore();
    enabled.mockRestore();
    f.close();
  }
});

test('synchronous read observer is gated and terminates each started span once', () => {
  const emit = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation(() => {});
  try {
    const disabled = createConversationReadDiagnostics(false);
    disabled.start('artifact_read_admission');
    disabled.finish();
    disabled.finish('failed');
    expect(emit).not.toHaveBeenCalled();
    const enabled = createConversationReadDiagnostics(true);
    enabled.start('artifact_read_admission');
    enabled.finish('failed');
    enabled.finish();
    expect(emit.mock.calls).toEqual([
      ['rag', 'artifact_read_admission', 'started'],
      ['rag', 'artifact_read_admission', 'failed'],
    ]);
  } finally {
    emit.mockRestore();
  }
});

test.each(['admission', 'settlement'] as const)(
  'preserves %s failures at the existing transaction boundary',
  async boundary => {
    const f = await sharedAncestryProfileFixture(1, false);
    const emit = jest
      .spyOn(diagnostics, 'providerDiagnostic')
      .mockImplementation(() => {});
    const enabled = jest
      .spyOn(history, 'historyValidationCostEnabled')
      .mockReturnValue(true);
    const transaction = f.database.transaction.bind(f.database);
    const error = new Error('synthetic transaction failure');
    try {
      const version = await f.storage.activeSessionVersion('session');
      if (version === null) throw new Error('Missing synthetic session');
      f.database.transaction = work =>
        boundary === 'admission'
          ? Promise.reject(error)
          : transaction(async tx => {
              await work(tx);
              throw error;
            });
      const operation = f.storage.beginReadOperation(undefined, {
        historyPage: true,
      });
      try {
        await expect(
          operation!.readSessionMany('session', version, ['turn-0']),
        ).rejects.toBe(error);
        expect(
          emit.mock.calls.filter(
            call => call[1] === `artifact_read_${boundary}`,
          ),
        ).toEqual([
          ['rag', `artifact_read_${boundary}`, 'started'],
          ['rag', `artifact_read_${boundary}`, 'failed'],
        ]);
      } finally {
        operation!.dispose();
      }
    } finally {
      f.database.transaction = transaction;
      emit.mockRestore();
      enabled.mockRestore();
      f.close();
    }
  },
);
