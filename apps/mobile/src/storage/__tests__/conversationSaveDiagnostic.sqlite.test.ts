import { NativeModules } from 'react-native';
import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { beginConversationSave } from '../conversationSaveDiagnostic';

function gate() {
  let arrive!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    arrive = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait() {
      arrive();
      return held;
    },
  };
}

const checkpoint = {
  id: 'synthetic-answer',
  sessionId: 'synthetic-session',
  sessionVersion: 0,
  createdAt: '2026-10-05T00:05:00.000Z',
  question: 'Synthetic question must not appear in diagnostics',
};
const answer = 'Synthetic answer must not appear in diagnostics';
const artifact = {
  id: checkpoint.id,
  sessionId: checkpoint.sessionId,
  createdAt: checkpoint.createdAt,
  question: checkpoint.question,
  answer,
  providerId: 'synthetic-fixture',
  modelId: 'synthetic-fixture',
  status: 'complete' as const,
  sources: [],
  citations: [],
};

const stage = (phase: string, outcome: string) => [
  'storage',
  `conversation_save_${phase}`,
  outcome,
];

test.each(['success', 'rollback', 'off'] as const)(
  'separates a real answer commit from admission and driver settlement: %s',
  async mode => {
    const sqlite = openSqliteTestDatabase(':memory:');
    const prior = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    const admission = gate();
    const settlement = gate();
    let hold = false;
    const database: SqlDatabase = {
      execute: sqlite.database.execute,
      async transaction(operation) {
        if (!hold) return sqlite.database.transaction(operation);
        await admission.wait();
        return sqlite.database.transaction(async tx => {
          await operation(tx);
          await settlement.wait(); // Real SQLite still has not committed.
          if (mode === 'rollback') throw new Error('synthetic rollback');
        });
      },
    };
    NativeModules.OrotProviderDiagnostics = { enabled: false, report };
    try {
      await runMigrations(database);
      const store = createConversationArtifactStorage(database);
      await store.createSession(
        checkpoint.sessionId,
        await store.currentGeneration(),
      );
      await store.startRequest(checkpoint);
      hold = true;
      NativeModules.OrotProviderDiagnostics.enabled = mode !== 'off';
      const save = store.append(artifact);
      // Attach the failure handler before releasing the real driver transaction.
      const settled = save.then(
        () => 'completed',
        () => 'failed',
      );
      await admission.entered;
      expect(report.mock.calls).toEqual(
        mode === 'off'
          ? []
          : [
              stage('prepare', 'started'),
              stage('prepare', 'completed'),
              stage('admission', 'started'),
            ],
      );
      admission.release();
      await settlement.entered;
      const expected = [
        stage('prepare', 'started'),
        stage('prepare', 'completed'),
        stage('admission', 'started'),
        stage('admission', 'completed'),
        stage('authority', 'started'),
        stage('authority', 'completed'),
        stage('lineage', 'started'),
        stage('lineage', 'completed'),
        stage('persist', 'started'),
        stage('persist', 'completed'),
        stage('settlement', 'started'),
      ];
      expect(report.mock.calls).toEqual(mode === 'off' ? [] : expected);
      settlement.release();
      const outcome = mode === 'rollback' ? 'failed' : 'completed';
      expect(await settled).toBe(outcome);
      expect(report.mock.calls).toEqual(
        mode === 'off' ? [] : [...expected, stage('settlement', outcome)],
      );
      hold = false;
      expect(
        await store.readCommittedCompletion({
          requestId: checkpoint.id,
          messageId: checkpoint.id,
          sessionId: checkpoint.sessionId,
          sessionVersion: 0,
        }),
      ).toBe(mode === 'rollback' ? null : answer);
    } finally {
      admission.release();
      settlement.release();
      NativeModules.OrotProviderDiagnostics = prior;
      sqlite.close();
    }
  },
);

test.each([
  [80, 'lineage_period_majority'],
  [20, 'lineage_period_seen'],
] as const)(
  'classifies nested periods once without making overlapping spans: %d',
  (period, classification) => {
    const prior = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled: true, report };
    let clock = 0;
    const mock = jest.spyOn(performance, 'now').mockImplementation(() => clock);
    try {
      const span = beginConversationSave()!;
      span.advance('lineage');
      for (let index = 0; index < 2; index++) {
        const end = span.beginPeriod();
        clock += period / 2;
        end();
      }
      clock = 100;
      span.advance('persist');
      expect(report.mock.calls).toEqual([
        stage('prepare', 'started'),
        stage('prepare', 'completed'),
        stage('lineage', 'started'),
        stage(classification, 'completed'),
        stage('lineage', 'completed'),
        stage('persist', 'started'),
      ]);
    } finally {
      mock.mockRestore();
      NativeModules.OrotProviderDiagnostics = prior;
    }
  },
);
