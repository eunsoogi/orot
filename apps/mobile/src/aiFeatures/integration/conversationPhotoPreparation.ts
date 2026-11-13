import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { createConversationPhotoImport } from '../../ragConversation/conversationPhotoImport';
import type { ConversationSubmittedInput } from '../../ragConversation/conversationSubmittedInput';
import type { AiFeatureLocalData } from './localData';
import type { requireSelectedAi } from './provider';
import { photoEvidenceCapability } from '../../ragConversation/conversationPhotoCapability';
import { commitConversationPhotoCheckpoint } from '../../ragConversation/conversationPhotoCheckpoint';
import { createConversationPhotoRetirement } from '../../ragConversation/conversationPhotoRetirement';
import { medicalDocumentFileDeletion } from '../../medicalDocuments/medicalDocumentNativeBridge';
import { evidenceConsentScope } from './evidenceConsentScope';

export function conversationPhotoPreparationOption(input: {
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly selectedAi?: () => Promise<ReturnType<typeof requireSelectedAi>>;
}) {
  return input.selectedAi
    ? {
        photoPreparation: createConversationPhotoPreparation({
          loadLocalData: input.loadLocalData,
          selectedAi: input.selectedAi,
        }),
      }
    : {};
}

/** Bind staged ownership to one durable turn before any photo consent or provider call. */
export function createConversationPhotoPreparation(input: {
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly selectedAi: () => Promise<ReturnType<typeof requireSelectedAi>>;
}) {
  const openStorage = async () => {
    const data = await input.loadLocalData();
    if (!data.openConversationArtifactStorage)
      throw new Error('Conversation storage is unavailable.');
    return { data, storage: await data.openConversationArtifactStorage() };
  };
  const retirement = createConversationPhotoRetirement({
    fence: async id =>
      (await openStorage()).storage.invalidateRequestSource(id),
    discard: medicalDocumentFileDeletion.discard,
  });
  return {
    retirement,
    async prepare(args: {
      readonly drafts: ReturnType<typeof createConversationPhotoImport>;
      readonly sessionId: number;
      readonly durableSession: {
        readonly id: string;
        readonly version: number;
      };
      readonly requestId: string;
      readonly question: string;
      readonly signal: AbortSignal;
      readonly confirm: NonNullable<
        RagConversationObserver['photoInput']
      >['confirm'];
      readonly start: (submitted: ConversationSubmittedInput) => Promise<void>;
    }): Promise<NonNullable<RagConversationObserver['photoInput']>> {
      const lease = args.drafts.beginHandoff(args.sessionId, {
        sessionId: args.durableSession.id,
        sessionVersion: args.durableSession.version,
        requestId: args.requestId,
        inputRevision: 0,
      });
      if (!lease) throw new Error('Conversation photo is unavailable.');
      if (lease.stagingGeneration === undefined) {
        await lease.rollback();
        throw new Error('Conversation photo is unavailable.');
      }
      let attempted = false;
      try {
        const selected = await input.selectedAi();
        const { data, storage } = await openStorage();
        if (
          args.signal.aborted ||
          photoEvidenceCapability(
            selected.provider.capabilities,
            lease.photo,
          ) !== 'ocr' ||
          (await storage.activeSessionVersion(args.durableSession.id)) !==
            args.durableSession.version
        )
          throw new Error('Conversation photo is unavailable.');
        const generation = await storage.currentGeneration();
        const submitted: ConversationSubmittedInput = {
          schemaVersion: 1,
          inputRevision: lease.identity.inputRevision,
          sessionId: args.durableSession.id,
          requestId: args.requestId,
          question: args.question,
          ocr: {
            providerId: selected.provider.id,
            modelId: selected.modelId,
            recipient: selected.recipient,
            remoteProcessing: selected.remoteProcessing,
            consentScope: evidenceConsentScope({
              purpose: 'record_conversation',
              generatedArtifacts: Boolean(
                data.summaryArtifactDiscovery ||
                data.conversationArtifactDiscovery ||
                data.researchArtifactDiscovery,
              ),
              external: true,
              publicWeb: Boolean(
                selected.remoteProcessing && selected.provider.searchPublicWeb,
              ),
              photo: true,
            }),
            source: {
              id: lease.photo.id,
              contentHash: lease.photo.contentHash,
            },
            deletionGeneration: generation,
            sections: lease.photo.sections,
          },
        };
        attempted = true;
        const checkpoint = await commitConversationPhotoCheckpoint({
          lease,
          submitted,
          storage,
          start: () => args.start(submitted),
          retire: retirement.retire,
          deferCommit: true,
        });
        if (!checkpoint) throw new Error('Conversation photo is unavailable.');
        let committed = false;
        let decision: Promise<void> | undefined;
        const settleUnsent = () => {
          // Serialize cancellation with approval before either changes ownership.
          decision ??= (async () => {
            try {
              await storage.releaseUnsentPhotoRequest({
                requestId: args.requestId,
                sessionId: args.durableSession.id,
                version: args.durableSession.version,
                submitted,
              });
            } catch (error) {
              // If returning ownership is uncertain, fence and retire it instead.
              // The retirement owner retains failures for an explicit retry.
              await checkpoint.commit();
              await retirement.retire(lease.photo.id);
              throw error;
            }
            await lease.rollback();
          })();
          return decision;
        };
        return {
          submitted,
          stagingGeneration: lease.stagingGeneration,
          ...(lease.photo.previewData
            ? { previewData: lease.photo.previewData }
            : {}),
          settleUnsent,
          confirm: async (details, signal) => {
            let approved = false;
            try {
              approved = await args.confirm(details, signal);
            } finally {
              if (!approved) await settleUnsent();
            }
            if (!approved || signal.aborted) {
              await settleUnsent();
              return false;
            }
            decision ??= (async () => {
              await checkpoint.commit();
              committed = true;
            })();
            await decision;
            return committed;
          },
        };
      } catch (error) {
        if (!attempted) await lease.rollback();
        throw error;
      }
    },
  };
}
