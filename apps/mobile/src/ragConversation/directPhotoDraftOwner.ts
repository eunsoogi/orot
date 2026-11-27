import { AppState } from 'react-native';
import { createConversationListeners } from './conversationListeners';
import { conversationExecutionNative } from './conversationExecutionNative';

/** One app session store owns at most one settled, unsent group in memory.
 * Presentation unmounts do not retire it; actual protection and ownership do. */
export function createDirectPhotoDraftOwner(activeId: () => number | false) {
  type Draft = Readonly<{ id: number; images: readonly string[] }>;
  let selectedId = activeId();
  const owns = (id: number) => activeId() === id;
  let draft: Draft | undefined;
  let paused = false;
  let locked = false;
  let epoch = 0;
  let stop: (() => void) | undefined;
  let disposed = false;
  const changes = createConversationListeners();
  const interruption = createConversationListeners();

  const clear = (id?: number) => {
    if (!draft || (id !== undefined && draft.id !== id)) return;
    draft = undefined;
    changes.emit();
  };

  const retire = (id?: number) => {
    if (id !== undefined && !owns(id)) return;
    clear(id);
    interruption.emit();
  };

  const connect = () => {
    if (stop || disposed) return;
    const native = conversationExecutionNative();
    const retireProtection = () => {
      ++epoch;
      locked = true;
      paused = true;
      clear();
      interruption.emit();
    };
    const transition = (phase: typeof AppState.currentState) => {
      if (phase !== 'active') {
        ++epoch;
        paused = true;
        if (!native?.bridgeAvailable) clear();
        interruption.emit();
        return;
      }
      if (!paused) return;
      if (!draft && !locked) {
        paused = false;
        return;
      }
      const expected = ++epoch;
      const finish = (available: boolean) => {
        if (
          disposed ||
          expected !== epoch ||
          AppState.currentState !== 'active'
        )
          return;
        if (!available) {
          retireProtection();
          return;
        }
        locked = false;
        paused = false;
      };
      // Keep the existing mounted preview through benign app switcher phases,
      // but never allow another action until the native protection recheck.
      Promise.resolve()
        .then(() => native?.protectedDataAvailable())
        .then(
          value => finish(value === true),
          () => finish(false),
        );
    };
    const protection = native?.subscribe(event => {
      if (event.kind !== 'protectedData') return;
      if (!event.available) retireProtection();
      else if (locked && AppState.currentState === 'active')
        transition('active');
    });
    const phase = AppState.addEventListener('change', transition);
    stop = () => {
      protection?.();
      phase.remove();
    };
    if (
      AppState.currentState === 'background' ||
      AppState.currentState === 'inactive'
    )
      transition(AppState.currentState);
  };

  return {
    connect,
    clear,
    retire,
    paused: () => disposed || paused,
    revalidate() {
      const currentId = activeId();
      if (selectedId === currentId) return;
      selectedId = currentId;
      retire();
    },
    read(id: number) {
      return draft?.id === id && owns(id) ? draft.images : undefined;
    },
    replace(id: number, images?: readonly string[]) {
      if (disposed || !owns(id)) return;
      if (!images?.length) return clear(id);
      if (paused) return;
      draft = { id, images };
      changes.emit();
    },
    subscribe: changes.subscribe,
    interrupt: interruption.subscribe,
    dispose() {
      disposed = true;
      ++epoch;
      stop?.();
      stop = undefined;
      // The app owner is unmounting; forget bytes before releasing its observers.
      draft = undefined;
      changes.dispose();
      interruption.dispose();
    },
  };
}
