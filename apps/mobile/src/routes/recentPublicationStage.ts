import type { SettledRecentReceipt } from './recentSavedMaterialPageTypes';

export function createRecentPublicationStage(
  firstPage: boolean,
  owner: () => boolean,
  publish?: (receipt?: SettledRecentReceipt) => void,
) {
  let receipt: SettledRecentReceipt | undefined;
  const reset = () => {
    receipt?.dispose();
    receipt = undefined;
  };
  const enabled = firstPage && Boolean(publish);
  const registerSettled = (next: SettledRecentReceipt) => {
    reset();
    receipt = next;
  };
  return {
    options: enabled ? { settledOwner: owner, registerSettled } : {},
    capture(settle?: () => SettledRecentReceipt | undefined) {
      if (!enabled || !settle) return;
      reset();
      receipt = settle();
    },
    publish() {
      publish?.(receipt);
      receipt = undefined;
    },
    reset,
  };
}
