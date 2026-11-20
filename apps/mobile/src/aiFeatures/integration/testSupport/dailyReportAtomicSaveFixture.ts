// Register the synthetic native fingerprint before loading production Calendar consumers.
import { calendarFixture } from './dailyReportCalendarTestFixture';
import { createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createCredentialMutationOwner } from '../../../agent/execution/credentialMutation';
import { createDailyReportCalendarWindow } from '../../../healthEvidence/healthContext/dailyReportWindow';
import { readDailyReportSnapshot } from '../../../healthEvidence/healthContext/dailyReportSnapshot';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import * as recovery from '../dailyReportRecoveryBridge';
import { stableJson } from '../evidenceUtils';
import {
  atomicReportService,
  edited,
  interleaveDailyReportSave,
  outside,
} from './dailyReportAtomicSaveDatabase';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
} from './dailyReportFailureStageFixtures';
export const previous = 'previous-run';
export const candidate = 'synthetic-run';
export const competing = 'competing-run';
type Scenario =
  | 'equivalent'
  | 'included edit'
  | 'unrelated deletion'
  | 'repeated drift'
  | 'competing head'
  | 'stop'
  | 'read error'
  | 'remote'
  | 'refused'
  | 'unchanged calendar'
  | 'calendar drift'
  | 'head during reproof'
  | 'edit during reproof'
  | 'delete during reproof'
  | 'second save error'
  | 'selection during reproof'
  | 'selection during save'
  | 'no selection witness'
  | 'selection after commit'
  | 'stop after commit';
/** Inject only between genuine SQLite checkpoints; no personal/provider data or writes outside memory. */
export async function runAtomicSaveRace(scenario: Scenario) {
  const connection = openSqliteTestDatabase(':memory:');
  const controller = new AbortController();
  const native = scenario.includes('calendar') ? calendarFixture() : undefined;
  const listEvents = native && jest.spyOn(native.bridge, 'listEventsInRange');
  const remote = scenario === 'remote' || scenario === 'refused';
  const hasPrior = [
    'repeated drift',
    'competing head',
    'head during reproof',
  ].includes(scenario);
  const store = createDailyReportStorage(connection.database, native?.read);
  const auth = jest.fn(async (): Promise<'authorized' | 'renewal_required'> =>
    scenario === 'refused' ? 'renewal_required' : 'authorized',
  );
  const selection = createCredentialMutationOwner();
  const initialWitness = selection.capture();
  if (!initialWitness) throw new Error('Missing synthetic selection witness.');
  const switchSelection = () => selection.begin()();
  const baseRecovery = recovery.createDailyReportRecoveryBridge;
  const pendingStages = jest.fn();
  const restore = jest
    .spyOn(recovery, 'createDailyReportRecoveryBridge')
    .mockImplementation((...args) => {
      const actual = baseRecovery(...args);
      return (...stageArgs) => {
        pendingStages();
        return actual(...stageArgs);
      };
    });
  try {
    await prepareReportDatabase(connection.database);
    const repository = createRecordRepository(connection.database);
    if (
      scenario === 'unrelated deletion' ||
      scenario === 'delete during reproof'
    )
      await repository.put('health_observation', outside('outside-delete'));
    const window = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (window.status !== 'ready') throw new Error('Missing synthetic day.');
    const snapshot = () =>
      readDailyReportSnapshot(connection.database, window.context, {});
    const projection = async () => {
      const current = await snapshot();
      return stableJson({
        ...current,
        sourceSnapshot: {
          ...current.sourceSnapshot,
          revision: null,
          mutationGeneration: null,
        },
      });
    };
    if (hasPrior) {
      const seed = await atomicReportService(
        connection.database,
        reportProvider(),
        previous,
        false,
        async () => 'authorized',
      )(reportRequest());
      expect(seed.status).toBe('completed');
    }
    const publishCompeting = async () => {
      const prior = await store.lookup(window.context.identity);
      if (prior.status !== 'saved') throw new Error('Missing prior report.');
      const { mutationGeneration, revision } = (await snapshot())
        .sourceSnapshot;
      expect(
        await store.save({
          runId: competing,
          context: {
            ...prior.context,
            sourceSnapshot: {
              ...prior.context.sourceSnapshot,
              mutationGeneration,
              revision,
            },
          },
          result: { status: 'completed', report: prior.report },
          lineage: prior.lineage,
          mode: { kind: 'revise', expectedRunId: previous },
        }),
      ).toEqual({ status: 'saved' });
    };
    const late = async () => {
      if (native) expect(native.listeners.size).toBeGreaterThan(0);
      switch (scenario) {
        case 'repeated drift':
          await repository.put('health_observation', outside('outside-second'));
          break;
        case 'head during reproof':
          await publishCompeting();
          break;
        case 'edit during reproof':
          await repository.put('health_observation', edited);
          break;
        case 'delete during reproof':
          await repository.delete('health_observation', 'outside-delete');
          break;
        case 'stop':
          controller.abort();
          break;
        case 'calendar drift':
          native!.change();
          break;
        case 'selection during reproof':
          switchSelection();
          break;
        case 'read error':
          throw new Error('Synthetic proof read failure.');
      }
    };
    const interleaving = interleaveDailyReportSave(connection.database, {
      async afterProof(reads) {
        if (reads === 1) {
          const before = await projection();
          if (scenario === 'included edit')
            await repository.put('health_observation', edited);
          else if (scenario === 'unrelated deletion')
            await repository.delete('health_observation', 'outside-delete');
          else {
            if (scenario === 'competing head') await publishCompeting();
            await repository.put(
              'health_observation',
              outside('outside-first'),
            );
          }
          if (scenario === 'equivalent')
            expect(await projection()).toBe(before);
        } else if (reads === 2) await late();
      },
      beforeWrite: attempt => {
        if (attempt === 2 && scenario === 'second save error')
          throw new Error('Synthetic local save failure.');
      },
      didWrite: attempt => {
        if (attempt === 2 && scenario === 'selection during save')
          switchSelection();
      },
      didCommit: attempt => {
        if (attempt !== 2) return;
        if (scenario === 'selection after commit') switchSelection();
        if (scenario === 'stop after commit') controller.abort();
      },
    });
    const model = reportProvider();
    const generate = model.generate.bind(model);
    const dispatched = jest
      .spyOn(model, 'generate')
      .mockImplementation(async (...args) => {
        const response = await generate(...args);
        interleaving.returned();
        return response;
      });
    const outcome = await atomicReportService(
      interleaving.database,
      model,
      candidate,
      remote,
      auth,
      native,
      scenario === 'no selection witness'
        ? undefined
        : { isCurrent: initialWitness, subscribe: selection.subscribe },
    )({
      ...reportRequest(controller.signal),
      ...(hasPrior
        ? { mode: { kind: 'revise' as const, expectedRunId: previous } }
        : {}),
    });
    if (listEvents) expect(listEvents).toHaveBeenCalled();
    const heads = (
      await connection.database.execute(
        'SELECT active_run_id FROM daily_report_heads',
      )
    ).rows;
    const row = (
      await connection.database.execute(
        'SELECT id FROM symptom_summary_runs WHERE id = ?',
        [candidate],
      )
    ).rows;
    const saved = await store.lookup(window.context.identity);
    return {
      outcome,
      auth,
      dispatched,
      ...interleaving.observations(),
      heads,
      row,
      saved,
      native,
      pendingStages,
    };
  } finally {
    restore.mockRestore();
    connection.close();
  }
}
