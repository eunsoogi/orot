import { stableJson } from './evidenceUtils';
import type { ToolReferenceScopeSnapshot } from './toolReferenceScopeSnapshot';
import type {
  EvidenceReference,
  ConversationToolEvent,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type { StoredConversationToolTurn } from '../../storage/conversationToolEventStorage';
import {
  isExternalToolResearch,
  sameToolSource,
} from '../../storage/conversationToolExternalSource';
import type { EvidenceRegistrySnapshot } from './evidenceRegistrySnapshot';
import type { ColdConversationSourceOwner } from './coldConversationSourceResolvers';

/** Convert protected durable source identities to this run's exact aliases, never a global registry.
 * The caller obtains turns from readToolTurns with expectedVersion (including lineage validation).
 * Missing/ambiguous/filtered sources stay unopenable; no reader, search or alias allocation occurs. */
export function coldConversationToolEvents(
  turns: readonly StoredConversationToolTurn[],
  owner: ColdConversationSourceOwner,
  snapshot: EvidenceRegistrySnapshot,
  researchTarget?: (
    source: ToolSourceReference,
    callId: string,
  ) => EvidenceReference | undefined,
): readonly ConversationToolEvent[] {
  const matching = turns.filter(turn => turn.messageId === owner.requestId);
  if (matching.length > 1 || !Array.isArray(snapshot?.entries))
    throw new Error('Ambiguous cold tool source owner.');
  const turn = matching[0];
  if (!turn) return [];
  const events = turn.toolEvents.filter(
    event => event.operationRunId === owner.operationRunId,
  );
  if (new Set(events.map(event => event.callId)).size !== events.length)
    throw new Error('Ambiguous cold tool call.');
  return events.map(event => {
    const lineages = turn.lineages.filter(
      value =>
        value.runId === event.operationRunId && value.callId === event.callId,
    );
    if (lineages.length !== 1) throw new Error('Cold tool lineage missing.');
    const sources = event.sources.flatMap((source): ToolSourceReference[] => {
      const dependencies = lineages[0]!.sources.filter(value =>
        sameToolSource(value.reference, source),
      );
      if (dependencies.length !== 1) return [];
      const dependency = dependencies[0]!;
      if (source.sourceKind === 'external_medical') {
        if (!isExternalToolResearch(dependency)) return [];
        const target = researchTarget?.(source, event.callId);
        const saved = dependency.research;
        return target &&
          sameToolSource(target, saved.reference) &&
          target.sourceKind === 'generated_artifact' &&
          target.sourceId === saved.id &&
          target.evidenceId === saved.id &&
          target.sourceRevision === saved.revision &&
          target.evidenceRevision === saved.revision &&
          stableJson(target.locator) === stableJson(saved.reference.locator)
          ? [source]
          : [];
      }
      if (
        isExternalToolResearch(dependency) ||
        ('kind' in dependency &&
          dependency.kind === 'filtered_medication_period')
      )
        return [];
      const matches = snapshot.entries.filter(entry =>
        sameToolSource(entry.original, source),
      );
      if (matches.length !== 1) return [];
      const alias = matches[0]!.alias;
      return [
        {
          sourceKind: alias.sourceKind,
          sourceId: alias.sourceId,
          sourceRevision: alias.sourceRevision,
          evidenceId: alias.evidenceId,
          evidenceRevision: alias.evidenceRevision,
        },
      ];
    });
    return { ...event, sources };
  });
}

/** Read-only inspection may project ready protected bindings, but never upgrades pending/null ones. */
export function coldSnapshotResearchTarget(
  scope: ToolReferenceScopeSnapshot,
  snapshot: EvidenceRegistrySnapshot,
  owner: ColdConversationSourceOwner,
) {
  return (source: ToolSourceReference, callId: string) => {
    if (
      scope?.version !== 1 ||
      scope.scope?.sessionId !== owner.sessionId ||
      scope.scope.operationRunId !== owner.operationRunId ||
      !scope.knownCallIds?.includes(callId) ||
      !Array.isArray(scope.ready)
    )
      return undefined;
    const matches = scope.ready.filter(
      row => row.callId === callId && sameToolSource(row.source, source),
    );
    const target = matches.length === 1 ? matches[0]!.target : undefined;
    return target &&
      snapshot.entries.some(row => stableJson(row) === stableJson(target))
      ? target.original
      : undefined;
  };
}
