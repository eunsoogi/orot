import type { EvidenceReference } from '@orot/agent-runtime';
import type {
  ArchivedCitationTarget,
  ResolveArchivedCitation,
} from '../../ragConversation/useArchivedCitationOpen';
import { isConversationPhotoSource } from '../../ragConversation/conversationArtifactSources';
import type { ColdConversationSourceOwner } from './coldConversationSourceResolvers';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { AiFeatureLocalData } from './localData';
import { stableJson } from './evidenceUtils';
import { restoreRetainedSources } from './restoreRetainedSources';

/** No archive read until a source chip is pressed. Only this selected reference
 * can reach the canonical viewer; the viewer re-checks the same protected row
 * and local source, then re-checks ownership again before serving a document. */
export function createArchivedCitationService(
  loadLocalData: () => Promise<AiFeatureLocalData>,
) {
  async function selected(
    target: ArchivedCitationTarget,
    ordinal: number,
    signal: AbortSignal,
  ) {
    if (signal.aborted) return null;
    const data = await loadLocalData();
    const storage = await data.openConversationArtifactStorage?.();
    const source = await storage?.readSelectedArchivedCitation(
      target.sessionId,
      target.sessionVersion,
      target.turnId,
      target.createdAt,
      ordinal,
    );
    return !signal.aborted && source && !isConversationPhotoSource(source)
      ? { data, source }
      : null;
  }

  const resolve: ResolveArchivedCitation = async (target, ordinal, signal) => {
    const entry = await selected(target, ordinal, signal);
    if (!entry) return;
    const { reference } = entry.source;
    if (reference.sourceKind === 'external_medical')
      return { kind: 'external', reference };
    return {
      kind: 'detail',
      reference,
      owner: {
        sessionId: target.sessionId,
        sessionVersion: target.sessionVersion,
        requestId: target.turnId,
        operationRunId: 'archived-citation',
        archiveCitation: { createdAt: target.createdAt, ordinal },
      },
    };
  };

  async function read(
    owner: ColdConversationSourceOwner,
    reference: EvidenceReference,
    signal: AbortSignal,
  ) {
    const key = owner.archiveCitation;
    const unavailable = { status: 'unavailable' } as const;
    if (!key || owner.operationRunId !== 'archived-citation')
      return unavailable;
    const target = {
      sessionId: owner.sessionId,
      sessionVersion: owner.sessionVersion,
      turnId: owner.requestId,
      createdAt: key.createdAt,
    };
    try {
      const entry = await selected(target, key.ordinal, signal);
      if (
        !entry ||
        stableJson(entry.source.reference) !== stableJson(reference)
      )
        return unavailable;
      const registry = new LocalEvidenceReferenceRegistry();
      const result = await restoreRetainedSources(
        [entry.source],
        registry,
        entry.data,
        'omit',
      );
      const alias = result.mapping.get(stableJson(entry.source.reference));
      if (!alias || result.sourceChanged || signal.aborted) return unavailable;
      const document = await registry.readSource(alias, signal);
      const current = await selected(target, key.ordinal, signal);
      return current && stableJson(current.source) === stableJson(entry.source)
        ? document
        : unavailable;
    } catch {
      return unavailable;
    }
  }
  return { resolve, read };
}

/** Archived entry points share the existing source-detail navigation receiver. */
export function createArchivedCitationRouting(
  load: () => Promise<AiFeatureLocalData>,
  cold: Pick<
    ReturnType<
      typeof import('./coldConversationServices').createColdConversationServices
    >,
    'readColdConversationSource' | 'resolveColdConversationToolSource'
  >,
) {
  const archive = createArchivedCitationService(load);
  return {
    resolveArchivedCitation: archive.resolve,
    resolveColdConversationToolSource: cold.resolveColdConversationToolSource,
    readColdConversationSource: (...args: Parameters<typeof archive.read>) =>
      args[0].archiveCitation
        ? archive.read(...args)
        : cold.readColdConversationSource(...args),
  };
}
