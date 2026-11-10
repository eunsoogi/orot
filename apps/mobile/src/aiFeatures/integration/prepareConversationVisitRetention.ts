import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureServices } from './featureServices';
import type { generateConversationVisitQuestions } from './conversationVisitQuestions';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import { prepareConversationVisitTarget } from './conversationVisitTarget';
import { captureConversationVisitCandidates } from './captureConversationVisitCandidates';
import { RetainedSourceInvalidError } from './retainedSourceError';

type Ready = Extract<
  Awaited<ReturnType<typeof generateConversationVisitQuestions>>,
  { status: 'ready' }
>;

/** A retry re-reads the visit and sources; it never repeats the model call. */
export function prepareConversationVisitRetention(input: {
  result: Ready;
  question: string;
  answer: string;
  loadLocalData: () => Promise<AiFeatureLocalData>;
  registry: LocalEvidenceReferenceRegistry;
  registerSource: AiFeatureServices['registerVisitQuestionSource'];
}) {
  return async (signal: AbortSignal) => {
    const { result } = input;
    const data = await input.loadLocalData();
    const matches = async () => {
      const current = await data.repository.readRecord(
        'appointment',
        result.appointment.id,
        signal,
      );
      return (
        current &&
        localEvidenceFingerprint(current) ===
          localEvidenceFingerprint(result.appointment)
      );
    };
    if (!(await matches()))
      throw new RetainedSourceInvalidError('The visit changed.');
    const target = await prepareConversationVisitTarget({
      data,
      registry: input.registry,
      appointmentId: result.appointment.id,
      signal,
    });
    if (!target || !(await matches()))
      throw new RetainedSourceInvalidError('The visit changed.');
    const captured = await captureConversationVisitCandidates({
      target,
      candidates: result.review.items
        .filter(item => item.origin === 'candidate')
        .map(item => item.question),
      validate: result.generation.validateSource,
      register: input.registerSource,
      registry: input.registry,
      signal,
    });
    return {
      question: input.question,
      answer: input.answer,
      providerId: result.selectedAi.provider.id,
      modelId: result.selectedAi.modelId,
      sources: captured.sources,
      citations: [],
      visitQuestions: {
        appointmentId: result.appointment.id,
        source: captured.source,
        candidates: captured.candidates,
      },
    };
  };
}
