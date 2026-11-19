import { isSQLCipher } from '@op-engineering/op-sqlite';
import { TurboModuleRegistry } from 'react-native';
import { assertPeriodNotRemoved } from '../src/storage/conversationPeriodRemoval';
import type { SavedPeriodSummarySource } from '../src/diseaseHypotheses/savedSummaries';
import { contextWindow } from './healthContextNativeFixtures';

type Snapshot = {
  cachedStatements: number;
  maximumRuns: number;
  ownerClosed: boolean;
  stepEntered: boolean;
  interruptObserved: boolean;
  timedOut: boolean;
  closeSeen: boolean;
  closeStatements: number;
  closeBusy: number;
};
type Fixture = {
  execute(sql: string): Promise<unknown>;
  arm(sql: string): Promise<boolean>;
  interrupt(): void;
  invalidate(): void;
  snapshot(): Snapshot;
  dispose(): boolean;
  verifyReopen(): boolean;
};
function check(condition: boolean, message: string) {
  if (!condition) throw new Error(`Native owner fixture: ${message}`);
}
async function measurementQuery() {
  const source: SavedPeriodSummarySource = {
    kind: 'health_context_period',
    revision: 'synthetic',
    deletionGeneration: 0,
    reference: {
      sourceKind: 'personal_record',
      sourceId: 'synthetic',
      sourceRevision: '1',
      evidenceId: 'synthetic',
      evidenceRevision: '1',
      locator: { kind: 'structured_record', recordId: 'synthetic' },
      effectiveTime: contextWindow.fromInclusive,
      reviewState: 'reviewed',
    },
    scope: {
      kind: 'health_context_period',
      version: 1,
      topic: 'measurements',
      window: contextWindow,
    },
  };
  const queries: string[] = [];
  await assertPeriodNotRemoved(
    {
      execute: async sql => {
        queries.push(sql);
        return { rows: [] };
      },
    },
    source,
  );
  check(queries.length === 4, 'production measurement templates changed');
  return queries[0]!;
}
/** Actual JSI owner and encrypted synthetic DB. No name/key/path or external DB
 * handle can be supplied. Native trace events, not sleeps, prove active step. */
export async function runNativeCacheOwnerOperation() {
  check(isSQLCipher(), 'SQLCipher required');
  TurboModuleRegistry.getEnforcing('OrotNativeCacheTest');
  const create = (
    globalThis as typeof globalThis & {
      __orotCreateNativeCacheFixture?: () => Fixture;
    }
  ).__orotCreateNativeCacheFixture;
  check(typeof create === 'function', 'test-only JSI binding unavailable');
  const fixture = create!();
  let failed = false;
  try {
    const sql = await measurementQuery();
    await fixture.execute(sql);
    await fixture.execute(sql);
    const warm = fixture.snapshot();
    check(
      warm.cachedStatements > 0 && warm.maximumRuns >= 2,
      'compiled statement reuse unobserved',
    );
    const cancel = async (invalidate: boolean) => {
      const entered = fixture.arm(sql);
      const outcome = fixture.execute(sql).then(
        () => false,
        error => /interrupted/i.test(String(error)),
      );
      await Promise.race([
        entered,
        outcome.then(() => {
          throw new Error(
            'Native query completed before active-step acknowledgement',
          );
        }),
      ]);
      if (invalidate) fixture.invalidate();
      else fixture.interrupt();
      check(await outcome, 'actual SQLite interruption required');
      const snapshot = fixture.snapshot();
      check(
        snapshot.stepEntered &&
          snapshot.interruptObserved &&
          !snapshot.timedOut,
        'trace deadline or absent interrupt',
      );
      return snapshot;
    };
    await cancel(false);
    await fixture.execute(sql);
    const invalidated = await cancel(true);
    check(
      invalidated.ownerClosed && invalidated.cachedStatements === 0,
      'owner did not close',
    );
    check(
      invalidated.closeSeen &&
        invalidated.closeStatements === 0 &&
        invalidated.closeBusy === 0,
      'compiled handles remained at close',
    );
    check(fixture.verifyReopen(), 'encrypted owned file did not reopen');
    return {
      reopenedAfterInvalidation: true,
      synthetic: true,
      encrypted: true,
      cacheReuseObserved: true,
      activeInterruptObserved: true,
      ownerInvalidationObserved: true,
      noStatementsAtClose: true,
      recoveredAfterInterrupt: true,
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      check(fixture.dispose(), 'owned directory cleanup failed');
    } catch (error) {
      if (!failed) throw error;
    }
  }
}
