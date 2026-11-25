import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import { composeEncounterModel } from '../agent/encounter/modelComposition';
import { extractEncounterCandidates } from '../agent/encounter/extraction';
import type { extractLocalTranscriptPages } from './extractLocalTranscriptPages';

/** Existing exact model execution, with one non-replayable invocation per page. */
export function encounterPageModel(input: {
  readonly sourceId: string;
  readonly executionId: string;
  readonly selected: Extract<SelectedAiResolution, { status: 'ready' }>;
  readonly consent: ExecutionConsentPort;
}): Parameters<typeof extractLocalTranscriptPages>[0]['extract'] {
  return (transcript, index, isCurrent, signal) => {
    const model = composeEncounterModel(
      input.sourceId,
      input.executionId + ':page:' + index,
      input.selected,
      input.consent,
    );
    let started = false;
    const provider = {
      id: model.provider.id,
      kind: model.provider.kind,
      displayName: model.provider.displayName,
      capabilities: { ...model.provider.capabilities, streaming: false },
      async generate(...args: Parameters<typeof model.provider.generate>) {
        if (!(await isCurrent()) || signal.aborted || started)
          throw new Error('The selected transcript page is unavailable.');
        started = true;
        return model.provider.generate(...args);
      },
    };
    return extractEncounterCandidates({
      transcript,
      model: { ...model, provider },
      isCurrent,
      signal,
    });
  };
}
