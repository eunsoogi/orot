import {
  ownsActiveArchiveLease,
  type ContinuousConversationStore,
} from './conversationSelectionReady';
import { createConversationInitialPageAdmission } from './conversationInitialPageAdmission';
import type { ConversationSessionOptions } from './conversationSessionTypes';

type Resolve = NonNullable<ConversationSessionOptions['continuousSession']>;
type Target = Awaited<ReturnType<Resolve>>;
const targetCurrent = (target: Target) => target.selectionCurrent?.() === true;

/** The app owns root tab visibility independently of mounted scenes and app background. */
export function createConversationRootRestoreOwnership() {
  let visible: boolean | undefined;
  let active:
    | {
        readonly target: Target;
        readonly signal: AbortSignal;
        readonly admission: ReturnType<
          typeof createConversationInitialPageAdmission
        >;
        release?: () => void;
        freshAuthority?: () => boolean;
      }
    | undefined;
  let check: { controller: AbortController; work: Promise<void> } | undefined;
  const stopCheck = () => {
    check?.controller.abort();
    check = undefined;
  };
  const clear = () => {
    active = undefined;
    stopCheck();
  };
  return {
    clear,
    get visible() {
      return visible === true;
    },
    get target() {
      return active?.target;
    },
    setVisible(next: boolean) {
      visible = next;
      if (!next) {
        stopCheck();
        if (active && !active.release) active.release = active.admission.hold();
      }
    },
    start(target: Target, signal: AbortSignal) {
      if (visible === undefined || target.selectionCurrent?.() !== true)
        return undefined;
      const admission = createConversationInitialPageAdmission();
      const owner: NonNullable<typeof active> = { target, signal, admission };
      active = owner;
      if (!visible) owner.release = admission.hold();
      return {
        admission: {
          async wait(readSignal: AbortSignal) {
            const assertAdmitted = await admission.wait(readSignal);
            const assertCurrent = () => {
              assertAdmitted();
              if (
                active !== owner ||
                !visible ||
                target.selectionCurrent?.() !== true ||
                (owner.freshAuthority && !owner.freshAuthority())
              )
                throw new Error('Conversation restoration was cancelled.');
            };
            assertCurrent();
            return assertCurrent;
          },
        },
        selectionCurrent: target.selectionCurrent,
        finish() {
          if (active === owner) clear();
        },
      };
    },
    reconcile(input: {
      resolve: Resolve;
      attached(target: Target): boolean;
      restart(): Promise<void>;
    }): Promise<void> | undefined {
      const owner = active;
      const release = owner?.release;
      if (!owner || owner.signal.aborted || !visible) return undefined;
      // Root intent may have finished before scene commit, but a successful
      // check cannot suppress a newer credential/lease transition.
      if (!release)
        return owner.freshAuthority?.() === true &&
          targetCurrent(owner.target) &&
          input.attached(owner.target)
          ? Promise.resolve()
          : undefined;
      if (check) return check.work;
      const controller = new AbortController();
      const current = () =>
        active === owner &&
        visible === true &&
        !owner.signal.aborted &&
        !controller.signal.aborted;
      const { target } = owner;
      const work = (async () => {
        let fresh: Target | undefined;
        try {
          fresh = await input.resolve(controller.signal);
        } catch {
          // Failed lookups are handled by the same strict path as a changed owner.
        }
        if (!current()) return;
        if (
          fresh?.id === target.id &&
          fresh.version === target.version &&
          fresh.model.providerId === target.model.providerId &&
          fresh.model.modelId === target.model.modelId &&
          target.selectionCurrent?.() === true &&
          fresh.selectionCurrent?.() === true &&
          input.attached(target)
        ) {
          owner.freshAuthority = fresh.selectionCurrent;
          owner.release = undefined;
          release();
        } else {
          clear();
          await input.restart();
        }
      })();
      check = { controller, work };
      work
        .finally(() => {
          if (check?.controller === controller) check = undefined;
        })
        .catch(() => {});
      return work;
    },
  };
}

/** Apply the same publication owner to first attachment and an authorized restart. */
async function runInitialOwnedArchive(
  root: ReturnType<typeof createConversationRootRestoreOwnership>,
  enabled: boolean,
  target: Target,
  signal: AbortSignal,
  current: () => boolean,
  run: (
    current: () => boolean,
    admission?: import('./conversationHistoryPage').ConversationInitialPageAdmission,
  ) => Promise<unknown>,
) {
  const owner = enabled ? root.start(target, signal) : undefined;
  try {
    await run(
      owner ? () => current() && owner.selectionCurrent() : current,
      owner?.admission,
    );
  } finally {
    owner?.finish();
  }
}

/** Bind start/restart to one already resolved model and protected lease. */
export function ownedArchiveRestore(input: {
  root: ReturnType<typeof createConversationRootRestoreOwnership>;
  store: ContinuousConversationStore;
  holdArchive: boolean;
  target: Target;
  signal: AbortSignal;
  current: () => boolean;
  retention: ConversationSessionOptions['retention'];
}) {
  const { root, store, holdArchive, target, signal, current, retention } =
    input;
  const run = (load: Parameters<typeof runInitialOwnedArchive>[5]) =>
    runInitialOwnedArchive(root, holdArchive, target, signal, current, load);
  return {
    attach: () =>
      run((valid, admission) =>
        store.attachExisting(
          target.id,
          target.version,
          target.updatedAt,
          true,
          valid,
          signal,
          admission,
        ),
      ),
    restart: (id: number) =>
      run((valid, admission) =>
        store.retryInitialRestore(
          id,
          target.id,
          signal,
          () =>
            valid() &&
            ownsActiveArchiveLease(store.getSnapshot(), retention, id, target),
          admission,
        ),
      ),
  };
}
