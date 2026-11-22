import type { Presentation } from './conversationModelControlCopy';
import type { OnDeviceSelectionWitness } from './provider';
import type { ReadReturningChatGPTTitle } from './readSavedChatGPTPresentation';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';

/** Use the existing protected-data and foreground bridge, presentation only. */
export function observeConversationModelLifecycle(
  changed: (fenced: boolean) => void,
) {
  const adapter = conversationExecutionNative();
  const nativeProtection = adapter?.bridgeAvailable === true;
  let foreground = adapter?.currentPhase?.() === 'active';
  let protectedData: boolean | undefined = nativeProtection ? undefined : true;
  let disposed = false;
  let selectedPlatform = false;
  let read = 0;
  const ready = () => foreground && protectedData === true;
  const setProtected = (available: boolean) => {
    const before = protectedData;
    protectedData = available;
    if (before !== available) changed(!available);
  };
  const snapshot = () => {
    if (!selectedPlatform || !nativeProtection || !foreground) return;
    const operation = ++read;
    adapter?.protectedDataAvailable().then(
      value => {
        if (!disposed && operation === read && foreground)
          setProtected(value === true);
      },
      () => {
        if (!disposed && operation === read && foreground) setProtected(false);
      },
    );
  };
  const unsubscribe = adapter?.subscribe(event => {
    if (disposed) return;
    if (event.kind === 'protectedData') {
      read++;
      setProtected(event.available);
    } else if (event.kind === 'phase' && foreground) {
      foreground = false;
      if (nativeProtection) protectedData = undefined;
      read++;
      changed(true);
    } else if (event.kind === 'foreground' && !foreground) {
      foreground = true;
      if (nativeProtection) {
        protectedData = undefined;
        snapshot();
      } else changed(false);
    }
  });
  return {
    ready,
    hasProtectedDataWitness: nativeProtection,
    observeSavedPlatform() {
      if (selectedPlatform) return;
      selectedPlatform = true;
      if (protectedData === undefined) snapshot();
    },
    foreground: () => foreground,
    canShowSavedName: () => nativeProtection && ready(),
    dispose() {
      disposed = true;
      unsubscribe?.();
    },
  };
}

/** A lifecycle return can publish only a fresh saved title, not a prior ready result. */
export function resumeSavedChatGPTTitle(
  read: ReadReturningChatGPTTitle,
  current: () => boolean,
  watch: (owner: OnDeviceSelectionWitness) => boolean,
  publish: (value: Presentation) => void,
) {
  read(current)
    .then(value => {
      if (
        value?.owner.isCurrent() &&
        current() &&
        watch(value.owner) &&
        current()
      )
        publish({
          status: 'saved-chatgpt-unverified',
          name: value.name,
          local: false,
        });
    })
    .catch(() => undefined);
}
