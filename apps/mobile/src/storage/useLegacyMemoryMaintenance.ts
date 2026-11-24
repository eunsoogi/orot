import { useEffect, useState } from 'react';
import type { SqlDatabase } from '@orot/storage';
import type { RecentMaterialReadyLease } from '../generatedReports/certifiedRecentMaterialPage';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from './localDataClearEvents';
import {
  notifyCommittedAgentMemoryVisibility,
  subscribeAgentMemoryVisibility,
} from './agentMemoryVisibilityEvents';
import type {
  LegacyMemorySweepStatus as LegacyStatus,
  LegacyMemorySweepResult as LegacyPage,
} from './legacyMemorySweep';
type LegacyOwner = SqlDatabase;
interface LegacyRootPorts {
  readonly open: () => Promise<LegacyOwner>;
  readonly stillCurrentOwner: (owner: LegacyOwner) => boolean;
  readonly step: (
    owner: LegacyOwner,
    lease: {
      readonly signal: AbortSignal;
      readonly current: () => boolean;
      readonly confirm: () => Promise<boolean>;
      readonly after?: number | null;
    },
  ) => Promise<LegacyPage>;
  readonly publish: (owner: LegacyOwner, status: LegacyStatus) => void;
  readonly watchCommitted: (
    owner: LegacyOwner,
    current: () => boolean,
    wake: () => void,
  ) => () => void;
  readonly delayMs: number;
}
/** The existing app root schedules one bounded storage maintenance quantum in
 * foreground. Neither first paint nor a Records/AI read owns this lifetime. */
function useProtectedLegacyMemoryMaintenance(ports: LegacyRootPorts) {
  const [readiness, setReadiness] = useState<RecentMaterialReadyLease>();
  useEffect(() => {
    const native = conversationExecutionNative();
    if (!native?.bridgeAvailable) return;
    let lease: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let disposed = false;
    let wakeAfterRetire = false;
    let owner: LegacyOwner | undefined;
    let after: number | null | undefined;
    // Deferred is not a grant; do not spin on a still oversized row.
    let lastDeferredOwner: LegacyOwner | undefined;
    let stopDeferred: (() => void) | undefined;
    let ready: RecentMaterialReadyLease | undefined;
    const revokeReady = () => {
      if (!ready) return;
      ready = undefined;
      if (!disposed) setReadiness(undefined);
    };
    const grantReady = (database: LegacyOwner) => {
      if (ready?.database === database && ready.isCurrent()) return;
      let live = true;
      const witness: RecentMaterialReadyLease = {
        database,
        isCurrent: () => {
          if (!active() || !ports.stillCurrentOwner(database)) live = false;
          return live && ready === witness && !disposed;
        },
      };
      ready = witness;
      setReadiness(witness);
    };
    const active = () => native.currentPhase?.() === 'active';
    const retire = (resetPass = false) => {
      lease?.abort();
      lease = undefined;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      owner = undefined;
      after = undefined;
      if (resetPass) {
        lastDeferredOwner = undefined;
        stopDeferred?.();
        stopDeferred = undefined;
      }
    };
    const schedule = () => {
      if (disposed || timer !== undefined || !active()) return;
      if (running) {
        if (!lease) wakeAfterRetire = true;
        return;
      }
      const request = lease ?? (lease = new AbortController());
      timer = setTimeout(async () => {
        timer = undefined;
        running = true;
        const current = () =>
          !disposed && active() && lease === request && !request.signal.aborted;
        const confirm = async () => {
          if (!current()) return false;
          try {
            return (
              (await native.protectedDataAvailable()) === true && current()
            );
          } catch {
            return false;
          }
        };
        let continuation = false;
        try {
          if (!(await confirm())) {
            revokeReady();
            return;
          }
          const captured = await ports.open();
          if (ready && ready.database !== captured) revokeReady();
          if (
            !current() ||
            !ports.stillCurrentOwner(captured) ||
            (owner !== undefined && owner !== captured)
          )
            return;
          if (ready?.isCurrent() || lastDeferredOwner === captured) return;
          if (ready) revokeReady();
          owner = captured;
          if (!(await confirm())) return;
          const page = await ports.step(captured, {
            signal: request.signal,
            current: () =>
              current() &&
              owner === captured &&
              ports.stillCurrentOwner(captured),
            confirm,
            after,
          });
          if (!(await confirm())) return;
          if (
            (await ports.open()) !== captured ||
            !(await confirm()) ||
            !current() ||
            owner !== captured ||
            !ports.stillCurrentOwner(captured)
          )
            return;
          if (
            page.status === 'pending' &&
            (page.after === undefined || page.after === after)
          )
            return;
          if (page.status === 'ready') grantReady(captured);
          else revokeReady();
          if (page.changed || page.status === 'ready')
            ports.publish(captured, page.status);
          if (page.status === 'pending') {
            after = page.after;
            continuation = true;
          } else if (page.status === 'deferred') {
            lastDeferredOwner = captured;
            stopDeferred?.();
            stopDeferred = ports.watchCommitted(
              captured,
              () =>
                !disposed &&
                lastDeferredOwner === captured &&
                ports.stillCurrentOwner(captured),
              () => {
                retire(true);
                schedule();
              },
            );
          }
        } catch {
          // A failed burst is retried on a new protected lifecycle event, not a spin.
        } finally {
          running = false;
          if (continuation || wakeAfterRetire) {
            wakeAfterRetire = false;
            schedule();
          } else if (lease === request) {
            retire();
          }
        }
      }, ports.delayMs);
    };
    const remove = native.subscribe(event => {
      if (
        event.kind === 'phase' ||
        (event.kind === 'protectedData' && !event.available)
      ) {
        wakeAfterRetire = false;
        revokeReady();
        retire(true);
      } else if (
        event.kind === 'foreground' ||
        (event.kind === 'protectedData' && event.available)
      ) {
        schedule();
      }
    });
    const removeClear = subscribeLocalDataClear(() => {
      revokeReady();
      retire(true);
      schedule();
    });
    const removeDelete = subscribeLocalSourceDeletion(() => {
      revokeReady();
      retire(true);
      schedule();
    });
    schedule();
    return () => {
      disposed = true;
      revokeReady();
      wakeAfterRetire = false;
      retire(true);
      removeClear();
      removeDelete();
      remove();
    };
  }, [ports]);
  return readiness;
}
let currentProductionMemoryOwner: ((owner: LegacyOwner) => boolean) | undefined;
const productionLegacyPorts: LegacyRootPorts = {
  async open() {
    const { openLocalAgentMemoryDatabase, isCurrentLocalAgentMemoryDatabase } =
      await import('./secureDatabase');
    currentProductionMemoryOwner = isCurrentLocalAgentMemoryDatabase;
    return openLocalAgentMemoryDatabase();
  },
  stillCurrentOwner(owner) {
    return currentProductionMemoryOwner?.(owner) === true;
  },
  async step(owner, lease) {
    const { runLegacyMemorySweep } = await import('./legacyMemorySweep');
    return runLegacyMemorySweep(owner, lease);
  },
  publish(owner) {
    notifyCommittedAgentMemoryVisibility(owner);
  },
  watchCommitted: subscribeAgentMemoryVisibility,
  // Yield between small quanta so application work can use the shared owner.
  delayMs: 150,
};
/** Called only by the foreground app root; a Records read never starts backfill. */
export function useLegacyMemoryMaintenance() {
  return useProtectedLegacyMemoryMaintenance(productionLegacyPorts);
}
