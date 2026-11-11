import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureServices } from './featureServices';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { loadSavedVisitQuestionState } from './savedVisitQuestions';
import { createVisitQuestionSourceService } from './visitQuestionSourceRegistration';
import { createConversationVisitTurn } from './conversationVisitTurn';
import { savedVisitQuestionLoadFailure } from './savedVisitQuestionFailure';

/** Assemble visit adapters and convert database setup failures to safe read codes. */
export function createVisitQuestionFeatureServices(input: {
  loadLocalData: () => Promise<AiFeatureLocalData>;
  privateLocalData: () => Promise<AiFeatureLocalData>;
  registry: LocalEvidenceReferenceRegistry;
}) {
  const generatedArtifactTools: NonNullable<
    AiFeatureServices['generatedArtifactTools']
  > = async () => {
    const data = await input.privateLocalData();
    return {
      tools: conversationGeneratedTools(data, input.registry, undefined).tools,
      validate: (references, signal) =>
        input.registry.revalidateEvidence(references, signal),
      owns: reference => Boolean(input.registry.resolve(reference)),
    };
  };
  const loadSavedVisitQuestions: AiFeatureServices['loadSavedVisitQuestions'] =
    async appointmentId => {
      try {
        const data = await input.loadLocalData();
        const { openLocalStorage } =
          await import('../../storage/secureDatabase');
        return await loadSavedVisitQuestionState({
          appointmentId,
          records: await openLocalStorage(),
          sourceReader: data.repository,
          registry: input.registry,
          readHealthContext: data.readHealthContext,
          data,
        });
      } catch {
        return savedVisitQuestionLoadFailure(
          appointmentId,
          'storage_read_failed',
        );
      }
    };
  const source = createVisitQuestionSourceService(
    input.registry,
    input.loadLocalData,
  );
  return {
    generatedArtifactTools,
    loadSavedVisitQuestions,
    ...source,
    prepareVisitQuestionTurn: createConversationVisitTurn({
      loadLocalData: input.privateLocalData,
      registry: input.registry,
      loadSaved: loadSavedVisitQuestions,
      generatedArtifactTools,
      registerSource: source.registerVisitQuestionSource,
    }),
  };
}
