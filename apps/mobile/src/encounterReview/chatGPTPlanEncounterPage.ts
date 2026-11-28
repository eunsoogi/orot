import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';
import { selectedChatGPTAccountId } from '../aiFeatures/integration/savedChatGPTModelLabel';
import { composeEncounterModel } from '../agent/encounter/modelComposition';
import { extractEncounterCandidates } from '../agent/encounter/extraction';
import type { extractLocalTranscriptPages } from './extractLocalTranscriptPages';
import {
  bindChatGPTPlanPageDispatch,
  type NativeChatGPTEncounterPageOwner,
} from './chatGPTPlanPageDispatch';

/** Dedicated native Plan path. An actual independently authoritative native
 * owner is required; neither the ordinary Plan bridge nor the API adapter
 * satisfies the submit contract. */
export function chatGPTPlanEncounterPage(input: {
  readonly selected: Extract<SelectedAiResolution, { status: 'ready' }>;
  readonly sourceId: string;
  readonly executionId: string;
  readonly consent: ExecutionConsentPort;
  readonly current: () => boolean;
  readonly native: NativeChatGPTEncounterPageOwner;
}): Parameters<typeof extractLocalTranscriptPages>[0]['extract'] | undefined {
  const { selected, sourceId, executionId, consent, native } = input;
  const account = selectedChatGPTAccountId(selected.selection);
  if (
    !account ||
    !selected.remoteProcessing ||
    selected.provider.id !== selected.selection.providerId ||
    selected.modelId !== selected.selection.modelId ||
    selected.option.provider.id !== selected.provider.id ||
    selected.option.modelId !== selected.modelId ||
    selected.option.privacyBoundary !== 'selected-context-remote'
  )
    return;
  return async (transcript, index, isCurrent, signal) => {
    if (
      transcript.sourceId !== sourceId ||
      signal.aborted ||
      !(await isCurrent())
    )
      throw new Error('The selected transcript page is unavailable.');
    const operation = executionId + ':page:' + index;
    const page = bindChatGPTPlanPageDispatch({
      transcript,
      consent,
      operation,
      account,
      providerId: selected.provider.id,
      model: selected.modelId,
      recipient: selected.recipient,
      isCurrent: input.current,
      native,
    });
    const model = composeEncounterModel(
      sourceId,
      operation,
      selected,
      page.consent,
    );
    return extractEncounterCandidates({
      transcript,
      model: {
        ...model,
        provider: {
          id: model.provider.id,
          kind: model.provider.kind,
          displayName: model.provider.displayName,
          capabilities: {
            ...model.provider.capabilities,
            streaming: false,
            structuredOutput: false,
            toolCalling: false,
          },
          generate: page.generate,
        },
      },
      isCurrent,
      signal,
    });
  };
}
