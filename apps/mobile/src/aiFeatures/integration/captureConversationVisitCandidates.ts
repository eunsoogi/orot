import type { EvidenceItem } from '@orot/agent-runtime';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { NextVisitQuestion } from '../../nextVisitQuestions/types';
import type { AiFeatureServices } from './featureServices';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { captureConversationSources } from './captureConversationSources';
import { stableJson } from './evidenceUtils';

/** Capture candidate sources with the validator from the same generation and keep their durable identities. */
export async function captureConversationVisitCandidates(input: {
  readonly target: EvidenceItem;
  readonly candidates: readonly NextVisitQuestion<VisitQuestionEvidenceItem>[];
  readonly validate: (
    reference: VisitQuestionEvidenceItem,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly register: AiFeatureServices['registerVisitQuestionSource'];
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
}) {
  const aliases = new Map<string, EvidenceItem>();
  for (const question of input.candidates)
    for (const reference of [
      ...question.citations,
      ...(question.generatedArtifactContext ?? []),
    ]) {
      const key = stableJson(reference);
      if (!aliases.has(key))
        aliases.set(
          key,
          input.registry.resolve(reference)
            ? reference
            : input.register(reference, signal =>
                input.validate(reference, signal),
              ),
        );
    }
  const captured = await captureConversationSources(
    [input.target, ...aliases.values()],
    input.registry,
    input.signal,
  );
  const source = captured.mapping.get(JSON.stringify(input.target));
  if (!source) throw new Error('The visit source cannot be retained.');
  const durable = (
    reference: VisitQuestionEvidenceItem,
  ): VisitQuestionEvidenceItem => {
    const alias = aliases.get(stableJson(reference));
    const original = alias && captured.mapping.get(JSON.stringify(alias));
    if (!original) throw new Error('A question source cannot be retained.');
    return { ...original, content: reference.content };
  };
  const candidates = input.candidates.map(question => ({
    identity: { id: question.identity!.id },
    ...(question.kind ? { kind: question.kind } : {}),
    questionText: question.questionText,
    rationale: question.rationale,
    priority: question.priority,
    citations: question.citations.map(durable),
    ...(question.generatedArtifactContext?.length
      ? {
          generatedArtifactContext:
            question.generatedArtifactContext.map(durable),
        }
      : {}),
  }));
  return { source, candidates, sources: captured.sources };
}
