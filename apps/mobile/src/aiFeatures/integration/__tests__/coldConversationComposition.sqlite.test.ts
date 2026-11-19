import { openLocalAgentMemoryDatabase } from '../../../storage/secureDatabase';
import { createConversationSessions } from '../../../ragConversation/conversationSessions';
import { conversationComposerDisabled } from '../../../ragConversation/conversationComposerDisabled';
import * as diagnostics from '../../../providers/diagnostics';
import { createAiFeatureServices } from '../featureServices';
import { consent } from '../featureServiceFixtures';
import type { AiFeatureLocalData } from '../localData';
import { loadProductionLocalData } from '../testSupport/loadProductionLocalData';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';

jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

/** The production composition over synthetic SQLite shares initialization only.
 * A failed setup retries, while concurrent discovery owners still get live reads. */
test('cold restore reuses summary storage setup across discovery owners and revalidates deletion', async () => {
  const f = await diverseHistoryProfileFixture(3, true);
  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
  const openAiFeatureLocalData: () => Promise<AiFeatureLocalData> =
    loadProductionLocalData();
  const options = createAiFeatureServices(consent, {
    loadLocalData: openAiFeatureLocalData,
  }).conversationSessionOptions();
  const sessions = createConversationSessions(options);
  const database = f.database;
  const transaction = database.transaction.bind(database);
  const direct = database.execute.bind(database);
  let queue = Promise.resolve();
  let setupAttempts = 0;
  let failSetup = true;
  database.transaction = work => {
    const pending = queue.then(() =>
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
      }),
    );
    queue = pending.catch(() => {});
    return pending;
  };
  const stages: Record<string, number> = {};
  const hydrationStarts: number[] = [];
  let hydrationMs = 0;
  let start = 0;
  const record = (stage: string) => {
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
        hydrationMs += performance.now() - hydrationStarts.pop()!;
    });
  try {
    const data = await openAiFeatureLocalData();
    const discovery = () =>
      data.summaryArtifactDiscovery!(new LocalEvidenceReferenceRegistry());
    const failed = await discovery();
    await expect(failed.read('summary-0')).rejects.toThrow(
      'Synthetic setup failure',
    );
    failSetup = false;
    const [left, right] = await Promise.all([discovery(), discovery()]);
    const cancelled = new AbortController();
    cancelled.abort();
    const version = (await f.storage.activeSessionVersion('session'))!;
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
      .sessions.find(item => item.id === id)!;
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
    await queue;
    f.close();
  }
});
