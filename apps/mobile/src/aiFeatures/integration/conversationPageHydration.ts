import type { ParentSnapshot } from './restoreConversationParentSource';
import { ownsConversationParentRead } from './conversationParentReadOwner';
import type { ConversationArtifact } from '../../storage/conversationArtifactCodec';
import {
  isGeneratedConversationSource,
  isConversationPhotoSource,
} from '../../ragConversation/conversationArtifactSources';
import {
  restoreConversationArtifact,
  restoreConversationArtifactSnapshot,
  type RestoreInput,
} from './restoreConversationArtifact';

/** Reuse only transaction-validated database snapshots, never hydrated validity.
 * Each visit still checks summaries, research, source status and native originals.
 * Live aliases always use strict discovery; final root validation gates publication. */
export function createConversationPageHydration(
  input: Omit<RestoreInput, 'id'>,
  ancestry: ReadonlyMap<string, ConversationArtifact>,
  strictReads?: RestoreInput['storage'],
  ownerData = input.data,
) {
  const active = new Set<string>();
  // Native ownership cannot be proved by the database graph. Keep the entire
  // affected subtree on its old strict path rather than infer native freshness.
  const eligible = (id: string, path = new Set<string>()): boolean => {
    const value = ancestry.get(id);
    if (
      !value ||
      path.has(id) ||
      value.submittedInput ||
      value.treatmentContext ||
      value.sources.some(isConversationPhotoSource)
    )
      return false;
    path.add(id);
    const result = value.sources
      .filter(isGeneratedConversationSource)
      .every(source => eligible(source.id, path));
    path.delete(id);
    return result;
  };
  type Result = Awaited<ReturnType<typeof restoreConversationArtifactSnapshot>>;
  const restore = async (id: string, strict = false): Promise<Result> => {
    if (input.signal.aborted) return null;
    if (active.has(id)) throw new Error('Conversation ancestry is cyclic.');
    active.add(id);
    try {
      const parentSnapshot = async (
        parentId: string,
        discovery: Parameters<ParentSnapshot>[0],
      ) => {
        // undefined selects the original strict discovery path, not a failed proof.
        const strictParent = !eligible(parentId);
        const owned = () =>
          ownsConversationParentRead(discovery, input.storage, ownerData);
        if (strictParent && (!strictReads || !owned())) return undefined;
        // Native parents still perform both original and DB checks. Only report
        // calculation uses this page's owner; live aliases retain original storage.
        const parent = await restore(parentId, strictParent);
        if (strictParent && !owned()) return undefined;
        return parent
          ? { revision: parent.revision, sourceStatus: parent.sourceStatus }
          : null;
      };
      return strict
        ? await restoreConversationArtifact(
            { ...input, id },
            strictReads,
            parentSnapshot,
          )
        : await restoreConversationArtifactSnapshot(
            { ...input, id },
            ancestry.get(id) ?? null,
            parentSnapshot,
          );
    } finally {
      active.delete(id);
    }
  };
  return restore;
}
