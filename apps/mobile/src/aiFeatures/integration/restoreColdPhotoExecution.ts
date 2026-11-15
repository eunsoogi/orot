import type { ConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import { decodeConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import { currentMedicalDocumentGeneration } from '../../medicalDocuments/medicalDocumentLifecycle';
import { bindConversationPhotoExecution } from './conversationPhotoService';
import { restoreColdPhotoEvidence } from './restoreColdPhotoEvidence';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { stableJson } from './evidenceUtils';

type Binding = Parameters<typeof bindConversationPhotoExecution>;
/** Recreate only a fresh photo consent adapter, never a stored grant. Graph/UI admission stays separate. */
export async function restoreColdPhotoExecution(input: {
  base: Binding[0];
  selected: Binding[3]['selected'];
  data: Binding[3]['data'];
  registry: LocalEvidenceReferenceRegistry;
  owner: Parameters<typeof restoreColdPhotoEvidence>[0]['owner'];
  submitted: ConversationSubmittedInput;
  evidenceIds: readonly string[];
  confirm: Binding[1]['confirm'];
  signal: AbortSignal;
}) {
  const submitted = decodeConversationSubmittedInput(
    JSON.parse(JSON.stringify(input.submitted)),
  );
  if (!submitted?.ocr || input.signal.aborted)
    throw new Error('Cold photo input unavailable.');
  const { ocr } = submitted;
  const selected = input.selected;
  if (
    ocr.providerId !== selected.provider.id ||
    ocr.modelId !== selected.modelId ||
    ocr.recipient !== selected.recipient ||
    ocr.remoteProcessing !== selected.remoteProcessing
  )
    throw new Error('Cold photo recipient changed.');
  const snapshot = input.registry.snapshot();
  const sources = ocr.sections.map(section => {
    const row = snapshot.entries.find(
      entry =>
        stableJson(entry.original.locator) ===
        stableJson({
          kind: 'conversation_photo',
          requestId: submitted.requestId,
          sectionId: section.id,
        }),
    );
    if (!row) throw new Error('Cold photo alias is unavailable.');
    return {
      kind: 'conversation_photo' as const,
      reference: row.original,
      requestId: submitted.requestId,
      sectionId: section.id,
    };
  });
  // Validate into an isolated owner; retain the original aliases and ordering, not newly generated ones.
  await restoreColdPhotoEvidence({
    ...input,
    submitted,
    sources,
    registry: new LocalEvidenceReferenceRegistry(),
  });
  const evidence = sources.map((source, index) => {
    const alias = snapshot.entries.find(
      entry => stableJson(entry.original) === stableJson(source.reference),
    )!.alias;
    return {
      ...alias,
      content: input.registry.redactText(
        `사용자가 현재 대화에 첨부한 사진에서 추출한 글자:\n${ocr.sections[index]!.text}`,
      ),
    };
  });
  if (
    stableJson(evidence.map(item => item.evidenceId)) !==
    stableJson(input.evidenceIds)
  )
    throw new Error('Cold photo evidence ordering changed.');
  const photo = {
    submitted,
    stagingGeneration: currentMedicalDocumentGeneration(),
    confirm: input.confirm,
  };
  return bindConversationPhotoExecution(input.base, photo, evidence, {
    selected,
    data: input.data,
    registry: input.registry,
    sessionVersion: input.owner.sessionVersion,
  });
}
