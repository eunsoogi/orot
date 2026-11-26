import { watchEncounterNativeAdmission } from '../encounterReview/nativeAdmission';
import type {
  createArchivedPairedDetailsOwner,
  MountedPairedDetailsMarker,
} from '../storage/archivedPairedDetailsOwner';

export async function openArchivedPairedDetail(input: {
  native: Parameters<typeof watchEncounterNativeAdmission>[0];
  signal: AbortSignal;
  current: () => boolean;
  marker: MountedPairedDetailsMarker;
  lease: { id: string; version: number };
  section: 0 | 1;
  verify: ReturnType<typeof createArchivedPairedDetailsOwner>;
}) {
  const native = watchEncounterNativeAdmission(
    input.native,
    input.signal,
    input.current,
  );
  if (!native) return;
  const controller = new AbortController();
  const held = input.verify.hold(() => controller.abort());
  if (!held) {
    native.dispose();
    return;
  }
  const dispose = () => {
    controller.signal.removeEventListener('abort', dispose);
    native.signal.removeEventListener('abort', retire);
    held.dispose();
    native.dispose();
  };
  const retire = () => {
    dispose();
    controller.abort();
  };
  native.signal.addEventListener('abort', retire, { once: true });
  controller.signal.addEventListener('abort', dispose, { once: true });
  const current = () =>
    !controller.signal.aborted &&
    held.current() &&
    !native.signal.aborted &&
    input.native?.currentPhase?.() === 'active' &&
    input.current();
  let keep = false;
  try {
    if (!current() || !(await native.confirm()) || !current()) return;
    if (
      !(await input.verify(input.marker, input.lease, current)) ||
      !(await native.confirm()) ||
      !current()
    )
      return;
    // A delete/edit while the second native probe was pending cannot survive
    // into publication. Recheck the same one row, never scan the thread.
    const verified = await input.verify(input.marker, input.lease, current);
    if (!verified || !current()) return;
    const selected = verified.panels[input.section];
    if (!selected) return;
    keep = true;
    // Keep both the native and mutation fences until the sheet leaves.
    return { selected, signal: controller.signal, dispose };
  } finally {
    if (!keep) dispose();
  }
}
