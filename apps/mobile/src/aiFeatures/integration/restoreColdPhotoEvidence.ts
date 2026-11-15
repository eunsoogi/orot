import type { ConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import { decodeConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import type { ConversationPhotoArtifactSource } from '../../ragConversation/conversationArtifactSources';
import type { AiFeatureLocalData } from './localData';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { registerConversationPhotoEvidence } from './conversationPhotoEvidence';
import { stableJson } from './evidenceUtils';

/** Rebind local OCR readers only. This neither restores a transmission grant nor enables graph replay.
 * Both protected request ownership and the separately retained native original must remain current. */
export async function restoreColdPhotoEvidence(input: {
  submitted: ConversationSubmittedInput;
  owner: { requestId: string; sessionId: string; sessionVersion: number };
  sources: readonly ConversationPhotoArtifactSource[];
  data: AiFeatureLocalData;
  registry: LocalEvidenceReferenceRegistry;
  signal: AbortSignal;
}) {
  const submitted = decodeConversationSubmittedInput(
    JSON.parse(JSON.stringify(input.submitted)),
  );
  const { data, signal } = input;
  const owner = { ...input.owner };
  const sources: readonly ConversationPhotoArtifactSource[] = JSON.parse(
    JSON.stringify(input.sources),
  );
  if (
    !submitted?.ocr ||
    submitted.requestId !== owner.requestId ||
    submitted.sessionId !== owner.sessionId ||
    !data.openConversationArtifactStorage ||
    !data.validateConversationPhotoInput ||
    signal.aborted
  )
    throw new Error('Cold photo ownership is unavailable.');
  const storage = await data.openConversationArtifactStorage();
  const expected = stableJson(submitted);
  const isCurrent = async (current: AbortSignal) => {
    if (
      current.aborted ||
      (await storage.activeSessionVersion(owner.sessionId)) !==
        owner.sessionVersion
    )
      return false;
    const saved = await storage.readRequestInput(
      owner.requestId,
      owner.sessionId,
      owner.sessionVersion,
    );
    return (
      !current.aborted &&
      saved !== null &&
      stableJson(saved) === expected &&
      (await data.validateConversationPhotoInput!(submitted, current)) &&
      !current.aborted
    );
  };
  if (!(await isCurrent(signal))) throw new Error('Cold photo source changed.');
  // Build readers in isolation; malformed descriptors cannot partially mutate the destination.
  const fresh = new LocalEvidenceReferenceRegistry();
  const evidence = registerConversationPhotoEvidence({
    submitted,
    registry: fresh,
    isCurrent,
  });
  for (const source of sources) {
    const match = evidence.find(
      item => stableJson(fresh.resolve(item)) === stableJson(source.reference),
    );
    if (
      source.kind !== 'conversation_photo' ||
      !match ||
      source.requestId !== owner.requestId ||
      stableJson(source.reference.locator) !==
        stableJson({
          kind: 'conversation_photo',
          requestId: owner.requestId,
          sectionId: source.sectionId,
        })
    )
      throw new Error('Cold photo section identity changed.');
  }
  if (
    !sources.length ||
    new Set(sources.map(value => stableJson(value.reference))).size !==
      sources.length
  )
    throw new Error('Cold photo source selection is invalid.');
  if (!(await isCurrent(signal)))
    throw new Error('Cold photo ownership changed.');
  return registerConversationPhotoEvidence({
    submitted,
    registry: input.registry,
    isCurrent,
  });
}
