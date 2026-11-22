import { stableJson } from './evidenceUtils';
import type { SelectedAiResolution } from './provider';
import type { HistoricalDialogueParent } from '../../storage/protectedPromptHistory';
import type { AiFeatureLocalData } from './localData';

export function parseColdDialogueParents(
  value: unknown,
): readonly HistoricalDialogueParent[] | undefined {
  if (
    !Array.isArray(value) ||
    value.some(
      item =>
        !item ||
        typeof item !== 'object' ||
        Object.keys(item).some(key => key !== 'id' && key !== 'createdAt') ||
        typeof item.id !== 'string' ||
        !item.id ||
        typeof item.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(item.createdAt)) ||
        new Date(item.createdAt).toISOString() !== item.createdAt,
    ) ||
    new Set(value.map(item => item.id)).size !== value.length
  )
    return;
  return value.map(({ id, createdAt }) => ({ id, createdAt }));
}

export type ColdDialogueCurrent = (
  signal: AbortSignal,
  parents?: readonly HistoricalDialogueParent[],
) => Promise<boolean>;

export async function createColdPromptDialogueGuard(
  completion: unknown,
  data: AiFeatureLocalData,
  lease: { id: string; version: number },
) {
  if (
    !completion ||
    typeof completion !== 'object' ||
    !('version' in completion)
  )
    throw new Error('Cold dialogue contract unavailable.');
  if (completion.version === 1) {
    if ('historicalDialogueParents' in completion)
      throw new Error('Unsupported legacy dialogue scope.');
    return;
  }
  const parents =
    'historicalDialogueParents' in completion &&
    parseColdDialogueParents(completion.historicalDialogueParents);
  if (
    completion.version !== 2 ||
    !parents ||
    !('priorDialogue' in completion) ||
    !Array.isArray(completion.priorDialogue) ||
    completion.priorDialogue.length !== parents.length ||
    !('historySources' in completion) ||
    !Array.isArray(completion.historySources) ||
    completion.historySources.length ||
    !data.openConversationArtifactStorage
  )
    throw new Error('Cold dialogue scope is unsupported.');
  const storage = await data.openConversationArtifactStorage();
  // The resume descriptor/checkpoint owner provides the exact durable lease.
  // No source definitions or old aliases are reintroduced for prompt-only text.
  const current: ColdDialogueCurrent = async (signal, expected) =>
    (!expected ||
      (expected.length === parents.length &&
        expected.every(
          (row, index) =>
            row.id === parents[index]!.id &&
            row.createdAt === parents[index]!.createdAt,
        ))) &&
    storage.protectedPromptHistoryIsCurrent(
      lease.id,
      lease.version,
      parents,
      signal,
    );
  return current;
}

/** The cold owner pins the same model, route, and credential recipient. */
export function coldSelectedModelIdentity(
  value: Extract<SelectedAiResolution, { status: 'ready' }>,
) {
  return stableJson({
    selection: value.selection,
    provider: value.provider.id,
    model: value.modelId,
    recipient: value.recipient,
    remote: value.remoteProcessing,
  });
}
