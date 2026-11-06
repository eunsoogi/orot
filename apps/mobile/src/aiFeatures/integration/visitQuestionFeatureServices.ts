import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureServices } from './featureServices';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { loadSavedVisitQuestionState } from './savedVisitQuestions';
import { createVisitQuestionSourceService } from './visitQuestionSourceRegistration';
import { createConversationVisitTurn } from './conversationVisitTurn';

/** Assemble the visit-specific adapters around the shared source registry. */
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
      const data = await input.loadLocalData();
      const { openLocalStorage } = await import('../../storage/secureDatabase');
      return loadSavedVisitQuestionState({
        appointmentId,
        records: await openLocalStorage(),
        sourceReader: data.repository,
        registry: input.registry,
        readHealthContext: data.readHealthContext,
        data,
      });
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
