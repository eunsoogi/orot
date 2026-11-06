import { isRagConversationAvailabilityQuestion } from '../../ragConversation/availabilityIntent';
import { requestsArtifactContinuation } from '../../ragConversation/artifactContinuation';
import type {
  RagConversationObserver,
  RagConversationOutcome,
} from '../../ragConversation/service';
import { withProviderStage } from '../../providers/diagnostics';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { continueArtifactSearch } from './continueArtifactSearch';
import { readConversationAvailability } from './readConversationAvailability';

/** Resolves local-only continuation and availability before provider selection. */
export async function conversationEarlyResponse(input: {
  readonly question: string;
  readonly observer?: RagConversationObserver;
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly targetData?: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
  readonly onData: () => void;
}): Promise<RagConversationOutcome | undefined> {
  const { observer, question, signal } = input;
  const load = () => {
    input.onData();
    return input.targetData
      ? Promise.resolve(input.targetData)
      : withProviderStage('rag', 'data', input.loadLocalData);
  };
  if (
    observer?.conversationScope &&
    observer.artifactContinuation &&
    requestsArtifactContinuation(question)
  ) {
    return continueArtifactSearch({
      data: await load(),
      registry: input.registry,
      scope: observer.conversationScope,
      continuation: observer.artifactContinuation,
      signal,
      onContinuation: value => observer.onArtifactContinuation?.(value),
    });
  }
  observer?.onArtifactContinuation?.(null);
  if (isRagConversationAvailabilityQuestion(question))
    return readConversationAvailability(await load(), signal);
  return undefined;
}
