import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationVisitQuestionReference } from '../../ragConversation/conversationVisitQuestionReference';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import { stableJson } from './evidenceUtils';

/** Replace durable source IDs with source-checked aliases before exposing a restored candidate. */
export function rebindConversationVisitCandidates(
  visit: ConversationVisitQuestionReference,
  bySource: ReadonlyMap<string, EvidenceReference>,
) {
  const rebind = ({ content, ...reference }: VisitQuestionEvidenceItem) => {
    const bound = bySource.get(stableJson(reference));
    return bound ? { ...bound, content } : null;
  };
  const candidates = visit.candidates.map(question => {
    const citations = question.citations.map(rebind);
    const generated = question.generatedArtifactContext?.map(rebind);
    if (citations.some(item => !item) || generated?.some(item => !item))
      return null;
    return {
      ...question,
      citations: citations as VisitQuestionEvidenceItem[],
      ...(generated
        ? { generatedArtifactContext: generated as VisitQuestionEvidenceItem[] }
        : {}),
    };
  });
  return candidates.some(item => !item)
    ? null
    : (candidates as NonNullable<(typeof candidates)[number]>[]);
}
