import type {
  ConversationToolEvent,
  EvidenceItem,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type { VisitQuestionEvidenceAliases } from './evidenceAliases';
import { visitQuestionEvidenceIdentityKey } from './evidenceAliases';
import type { VisitQuestionEvidenceItem } from './taskContract';

/** Translate operation-local aliases into registry aliases before durable tool-source capture. */
export function createVisitToolEventMapper(input: {
  readonly aliases: VisitQuestionEvidenceAliases;
  readonly register: (
    reference: VisitQuestionEvidenceItem,
    validate: (signal: AbortSignal) => Promise<boolean>,
  ) => EvidenceItem;
  readonly revalidate: (
    references: readonly VisitQuestionEvidenceItem[],
  ) => Promise<boolean>;
}) {
  const registered = new Map<string, ToolSourceReference>();
  return (event: ConversationToolEvent): ConversationToolEvent => ({
    ...event,
    sources: event.sources.flatMap(source => {
      const original = input.aliases.originalOf(source);
      if (!original) return [];
      const key = visitQuestionEvidenceIdentityKey(original);
      let mapped = registered.get(key);
      if (!mapped) {
        let alias: EvidenceItem;
        try {
          alias = input.register(
            original,
            async signal =>
              !signal.aborted && (await input.revalidate([original])),
          );
        } catch {
          // A source that cannot be registered stays unavailable; it must not alter the tool result.
          return [];
        }
        mapped = {
          sourceKind: alias.sourceKind,
          sourceId: alias.sourceId,
          sourceRevision: alias.sourceRevision,
          evidenceId: alias.evidenceId,
          evidenceRevision: alias.evidenceRevision,
        };
        registered.set(key, mapped);
      }
      return [mapped];
    }),
  });
}
