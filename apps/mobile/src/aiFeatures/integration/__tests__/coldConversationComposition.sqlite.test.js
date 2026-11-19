import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runInNewContext } from 'node:vm';
import { transformSync } from '@babel/core';
import { openLocalAgentMemoryDatabase } from '../../../storage/secureDatabase';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { conversationComposerDisabled } from '../../../ragConversation/conversationComposerDisabled';
import * as diagnostics from '../../../providers/diagnostics';
import { createAiFeatureServices } from '../featureServices';
import { consent } from '../featureServiceFixtures';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import * as projection from '../../../healthEvidence/healthContext/projection';
import * as revisions from '../../../healthEvidence/healthContext/scope';
/** Jest leaves Metro's lazy imports intact. Transform the two entry modules
 * while preserving production factory code and using Jest's actual dependencies. */
function loadProductionLocalData() {
  const load = (filename, overrides = {}) => {
    const transformed = transformSync(readFileSync(filename, 'utf8'), {
      filename,
      babelrc: false,
      configFile: false,
      presets: ['module:@react-native/babel-preset'],
      plugins: [
        require.resolve('@babel/plugin-transform-dynamic-import', {
          paths: [require.resolve('@babel/preset-env')],
        }),
      ],
    });
    const loaded = { exports: {} };
    runInNewContext(transformed.code, {
      module: loaded,
      exports: loaded.exports,
      require: name =>
        overrides[name] ??
        require(
          name.startsWith('.')
            ? './' + relative(__dirname, resolve(dirname(filename), name))
            : name,
        ),
    });
    return loaded.exports;
  };
  return load(require.resolve('../localData'), {
    './conversationLocalAccess': load(
      require.resolve('../conversationLocalAccess'),
    ),
  }).openAiFeatureLocalData;
}
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
/** Model the native adapter's admission order on the synchronous SQLite host. */
function serializeTransactions(database) {
  const transaction = database.transaction.bind(database);
  let idle = Promise.resolve();
  database.transaction = work => {
    const pending = idle.then(() => transaction(work));
    idle = pending.catch(() => {});
    return pending;
  };
  return () => idle;
}
/** The production composition over synthetic SQLite shares initialization only.
 * A failed setup retries, while concurrent discovery owners still get live reads. */
test('cold restore reuses summary storage setup across discovery owners and revalidates deletion', async () => {
  const f = await diverseHistoryProfileFixture(3, true);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
  const openAiFeatureLocalData = loadProductionLocalData();
  const options = createAiFeatureServices(consent, {
    loadLocalData: openAiFeatureLocalData,
  }).conversationSessionOptions();
  const sessions = createConversationSessions(options);
  const database = f.database;
  const drain = serializeTransactions(database);
  const transaction = database.transaction.bind(database);
  const direct = database.execute.bind(database);
  let setupAttempts = 0;
  let failSetup = true;
  database.transaction = work =>
    transaction(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        if (
          args[0].startsWith(
            'CREATE INDEX IF NOT EXISTS symptom_summary_order ',
          )
        ) {
          setupAttempts++;
          if (failSetup) throw new Error('Synthetic setup failure');
        }
        return execute(...args);
      };
      await work(tx);
    });
  const stages = {};
  const hydrationStarts = [];
  let hydrationMs = 0;
  let start = 0;
  const record = stage => {
    stages[stage] ??= performance.now() - start;
  };
  const diagnostic = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation((_feature, stage, outcome) => {
      if (
        (stage === 'history_timeline' && outcome === 'started') ||
        (stage === 'history_recheck' && outcome === 'completed')
      )
        record(stage);
      if (stage === 'artifact_source_hydration' && outcome === 'started')
        hydrationStarts.push(performance.now());
      if (stage === 'artifact_source_hydration' && outcome === 'completed')
        hydrationMs += performance.now() - hydrationStarts.pop();
    });
  try {
    const data = await openAiFeatureLocalData();
    const discovery = () =>
      data.summaryArtifactDiscovery(new LocalEvidenceReferenceRegistry());
    const failed = await discovery();
    await expect(failed.read('summary-0')).rejects.toThrow(
      'Synthetic setup failure',
    );
    failSetup = false;
    const [left, right] = await Promise.all([discovery(), discovery()]);
    const cancelled = new AbortController();
    cancelled.abort();
    const version = await f.storage.activeSessionVersion('session');
    const stop = sessions.subscribe(() => {
      const snapshot = sessions.getSnapshot();
      const selected = snapshot.sessions.find(
        item => item.id === snapshot.activeId,
      );
      if (selected?.restoring) {
        expect(selected.messages).toEqual([]);
        expect(conversationComposerDisabled(selected)).toBe(true);
      }
      if (selected?.messages.length) record('first_transcript_state');
    });
    start = performance.now();
    const [first, second, , id] = await Promise.all([
      left.read('summary-0'),
      right.read('summary-1'),
      expect(right.read('summary-2', cancelled.signal)).rejects.toThrow(
        'cancelled',
      ),
      sessions.attachExisting('session', version, '2026-11-01T00:00:00Z'),
    ]);
    stop();
    record('restoration_settled');
    expect(first?.sourceStatus).toBe('current');
    expect(second?.sourceStatus).toBe('current');
    const selected = sessions
      .getSnapshot()
      .sessions.find(item => item.id === id);
    expect(
      selected.messages.filter(item => item.role === 'assistant'),
    ).toHaveLength(3);
    expect(selected.restoreFailed).toBe(false);
    expect(conversationComposerDisabled(selected)).toBe(false);
    expect(Object.keys(stages)).toEqual([
      'history_timeline',
      'history_recheck',
      'first_transcript_state',
      'restoration_settled',
    ]);
    await direct('DELETE FROM health_observations WHERE id = ?', [f.inside.id]);
    expect(await left.read('summary-0')).toBeNull();
    expect(await right.read('summary-1')).toBeNull();
    console.info('SYNTHETIC_COLD_CONVERSATION', {
      setupAttempts,
      hydrationMs,
      stages,
    });
    expect(setupAttempts).toBe(2);
  } finally {
    diagnostic.mockRestore();
    sessions.dispose();
    await drain();
    f.close();
  }
});
/** Profile CPU within the production hydration stage on five long retained turns. */
test('profiles revision and presentation work after committed report reuse', async () => {
  const f = await diverseHistoryProfileFixture(5, true, '2022-10-01T00:00:00Z');
  const drain = serializeTransactions(f.database);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
  const loadLocalData = loadProductionLocalData();
  const options = createAiFeatureServices(consent, {
    loadLocalData,
  }).conversationSessionOptions();
  const stats = {
    hydrationMs: 0,
    revisionMs: 0,
    projectionMs: 0,
    revisionCalls: 0,
    projectionCalls: 0,
  };
  let start = null;
  const diagnostic = jest
    .spyOn(diagnostics, 'providerDiagnostic')
    .mockImplementation((_feature, stage, outcome) => {
      if (stage !== 'artifact_source_hydration') return;
      if (outcome === 'started') start = performance.now();
      else if (start !== null) {
        stats.hydrationMs += performance.now() - start;
        start = null;
      }
    });
  const observe = (module, name, key) => {
    const work = module[name];
    return jest.spyOn(module, name).mockImplementation((...args) => {
      if (start === null) return work(...args);
      const before = performance.now();
      try {
        return work(...args);
      } finally {
        stats[key + 'Ms'] += performance.now() - before;
        stats[key + 'Calls']++;
      }
    });
  };
  const revision = observe(revisions, 'healthContextRevision', 'revision');
  const project = observe(projection, 'projectHealthContext', 'projection');
  try {
    const fullStart = performance.now();
    const page = await options.restoreSessionPage(
      'session',
      new AbortController().signal,
    );
    expect(page.turns).toHaveLength(5);
    expect(page.turns.filter(turn => turn.historyUnavailable)).toEqual([]);
    expect(page.turns.every(turn => turn.citations.length)).toBe(true);
    expect(stats.revisionCalls).toBe(15);
    console.info('SYNTHETIC_LONG_SOURCE_HYDRATION', {
      ...stats,
      fullMs: performance.now() - fullStart,
    });
  } finally {
    diagnostic.mockRestore();
    revision.mockRestore();
    project.mockRestore();
    await drain();
    f.close();
  }
}, 60000);
