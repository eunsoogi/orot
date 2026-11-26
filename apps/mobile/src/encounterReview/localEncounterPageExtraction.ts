import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import { encounterPageModel } from './encounterPageModel';
import { createEncounterStartAdmission } from './startAdmission';
import { extractLocalTranscriptPages } from './extractLocalTranscriptPages';
import { openLocalTranscriptPages } from './localTranscriptPages';

/** The explicit local route prepares generation only. No graph checkpoint can
 * persist an in-progress page or resume generation from this function. */
export async function prepareLocalEncounterExtraction(input: {
  readonly read: Parameters<typeof openLocalTranscriptPages>[0];
  readonly selected: Extract<SelectedAiResolution, { status: 'ready' }>;
  readonly consent: ExecutionConsentPort;
  readonly executionId: string;
  readonly progress?: (completed: number) => void;
}): ReturnType<typeof extractLocalTranscriptPages> {
  const { read, selected } = input;
  const aborted = () => ({
    status: read.signal.aborted
      ? ('cancelled' as const)
      : ('unavailable' as const),
  });
  const witness = selected.onDeviceSelectionWitness;
  if (
    !witness ||
    selected.remoteProcessing ||
    selected.option.privacyBoundary !== 'on-device' ||
    selected.selection.providerId !== APPLE_PROVIDER_ID ||
    selected.provider.id !== APPLE_PROVIDER_ID ||
    selected.selection.modelId !== selected.modelId
  )
    return aborted();

  const admission = createEncounterStartAdmission(
    selected,
    input.consent,
    true,
  );
  const owner = new AbortController();
  const cancel = () => owner.abort();
  const checkSelection = () => {
    if (!admission.selectionCurrent()) cancel();
  };
  const current = () =>
    !read.signal.aborted &&
    !owner.signal.aborted &&
    read.ownerCurrent() &&
    admission.selectionCurrent();
  read.signal.addEventListener('abort', cancel, { once: true });
  let unsubscribe: (() => void) | undefined;
  try {
    unsubscribe = witness.subscribe(checkSelection);
    if (!current()) return aborted();
    const pages = await openLocalTranscriptPages({
      ...read,
      ownerCurrent: current,
      signal: owner.signal,
    });
    return await extractLocalTranscriptPages({
      sourceId: read.sourceId,
      signal: read.signal,
      selectionCurrent: current,
      pages,
      progress: input.progress,
      extract: encounterPageModel({
        sourceId: read.sourceId,
        executionId: input.executionId,
        selected,
        consent: admission.consent,
      }),
    });
  } catch {
    return aborted();
  } finally {
    unsubscribe?.();
    read.signal.removeEventListener('abort', cancel);
  }
}
