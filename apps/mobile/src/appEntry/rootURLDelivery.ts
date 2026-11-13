import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { AppRootTab } from '../navigation/rootTabs';
import {
  normalizeRootDestination,
  rootDestinationTab,
} from './rootDestination';
import type { RootDestination } from './rootDestination';
import type { createEntryArbiter } from './entryArbiter';

type Delivery = { id: string; destination: RootDestination };
type Result = 'empty' | 'opened' | 'deferred' | 'cancelled';

/** Preserve the inbox entry until a guarded root selection commits and is acknowledged. */
export function createRootURLDelivery(input: {
  arbiter: ReturnType<typeof createEntryArbiter>;
  peek: () => Promise<unknown>;
  acknowledge: (id: string) => Promise<void>;
  controller: NavigationController<AppNavigationRoute>;
  canEnter: () => boolean;
  selectTab: (tab: AppRootTab) => void;
  onGuardChange?: (active: boolean) => void;
}) {
  let applied: string | null = null;
  let cancelled: string | null = null;
  return (): Promise<Result> =>
    input.arbiter.run(async current => {
      const value = await input.peek();
      if (!current() || !input.canEnter()) return 'deferred';
      if (value == null) return 'empty';
      if (!value || typeof value !== 'object') return 'deferred';
      const entry = value as Partial<Delivery>;
      if (typeof entry.id !== 'string' || !entry.id) return 'deferred';
      const destination = normalizeRootDestination(entry.destination);
      if (!destination) {
        await input.acknowledge(entry.id);
        return 'deferred';
      }
      if (entry.id === applied) {
        await input.acknowledge(entry.id);
        applied = null;
        return 'opened';
      }
      if (entry.id === cancelled) {
        await input.acknowledge(entry.id);
        cancelled = null;
        return 'cancelled';
      }
      const before = input.controller.getSnapshot();
      // A detail remains intact: root navigation waits for its owner to close it.
      if (
        before.isTransitioning ||
        before.routes.length !== 1 ||
        before.currentRoute.name !== 'root'
      )
        return 'deferred';
      input.onGuardChange?.(true);
      let decision: Awaited<
        ReturnType<typeof input.controller.requestTabSwitchDecision>
      >;
      try {
        decision = await input.controller.requestTabSwitchDecision();
      } finally {
        input.onGuardChange?.(false);
      }
      if (!current()) return 'deferred';
      if (decision === 'declined') {
        cancelled = entry.id;
        if (!input.canEnter()) return 'deferred';
        await input.acknowledge(entry.id);
        cancelled = null;
        return 'cancelled';
      }
      if (!input.canEnter()) return 'deferred';
      if (decision !== 'approved') return 'deferred';
      const after = input.controller.getSnapshot();
      if (
        after.isTransitioning ||
        after.routes.length !== 1 ||
        after.currentRoute.key !== before.currentRoute.key
      )
        return 'deferred';
      cancelled = null;
      input.selectTab(rootDestinationTab(destination));
      applied = entry.id;
      await input.acknowledge(entry.id);
      applied = null;
      return 'opened';
    });
}
