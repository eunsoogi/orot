import { readColdConversationSearch } from './coldConversationSearch';
import type { SqlDatabase } from '@orot/storage';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import type { ConversationContinuationIdentity } from '../../storage/conversationWorkflowContinuationIdentity';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { createConversationColdResumeStorage } from '../../storage/conversationColdResumeStorage';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  createColdConversationSourceResolvers,
  type ColdConversationSourceOwner,
} from './coldConversationSourceResolvers';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { resumeColdRagConversation } from './resumeColdRagConversation';
import { captureConversationToolSources } from './captureConversationToolSources';
import { bindLiveConversationToolSources } from './bindLiveConversationToolSources';
import { COLD_RAG_FACTORY_VERSION } from './coldRagConversationState';

/** Protected local readers are selected by exact retained request/run, never by reusable aliases. */
export function createColdConversationServices(
  dependencies: RagConversationServiceDependencies,
  openDatabase: () => Promise<SqlDatabase> = async () =>
    (
      await import('../../storage/secureDatabase')
    ).openLocalAgentMemoryDatabase(),
) {
  const readers = createColdConversationSourceResolvers();
  const registered = new Map<
    string,
    {
      owner: ColdConversationSourceOwner;
      registry: LocalEvidenceReferenceRegistry;
    }
  >();
  const key = (sessionId: string, requestId: string) =>
    JSON.stringify([sessionId, requestId]);
  async function current(
    owner: ColdConversationSourceOwner,
    signal: AbortSignal,
  ) {
    if (signal.aborted) return false;
    const row = (
      await (
        await openDatabase()
      ).execute(
        `SELECT w.manifest FROM conversation_requests r
       JOIN conversation_workflow_resumes w ON w.request_id = r.id
       JOIN conversation_artifact_sessions s ON s.id = r.session_id
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation
       WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? AND s.version = r.session_version
       AND s.hidden = 0 AND r.status IN ('active', 'interrupted', 'completed')`,
        [owner.requestId, owner.sessionId, owner.sessionVersion],
      )
    ).rows[0];
    if (typeof row?.manifest !== 'string' || signal.aborted) return false;
    try {
      return JSON.parse(row.manifest).operationRunId === owner.operationRunId;
    } catch {
      return false;
    }
  }
  async function entry(
    event: ConversationToolEvent,
    sessionId: string,
    requestId: string,
  ) {
    const value = registered.get(key(sessionId, requestId));
    if (
      !value ||
      value.owner.operationRunId !== event.operationRunId ||
      !(await current(value.owner, new AbortController().signal))
    )
      throw new Error('Cold tool source owner unavailable.');
    return value;
  }
  return {
    readColdConversationSource: readers.readSource,
    async inspect(
      identity: ConversationContinuationIdentity,
      signal: AbortSignal,
    ) {
      if (signal.aborted) return undefined;
      const saved = await createConversationColdResumeStorage(
        await openDatabase(),
      ).open(identity);
      if (
        signal.aborted ||
        saved?.reconstruction.factoryVersion !== COLD_RAG_FACTORY_VERSION ||
        !saved.reconstruction.completion ||
        !saved.reconstruction.invocation
      )
        return undefined;
      try {
        readColdConversationSearch(saved.reconstruction);
      } catch {
        return undefined;
      }
      return {
        attempt: saved.attempt,
        operationRunId: saved.manifest.operationRunId,
      };
    },
    async stop(identity: ConversationContinuationIdentity) {
      await createConversationArtifactStorage(
        await openDatabase(),
      ).interruptRequest(
        identity.requestId,
        identity.sessionId,
        identity.sessionVersion,
        'interrupted',
        'user-stopped',
      );
    },
    async resume(
      identity: ConversationContinuationIdentity,
      signal: AbortSignal,
      observer: RagConversationObserver,
    ) {
      let sourceOwner: ColdConversationSourceOwner | undefined;
      const result = await resumeColdRagConversation({
        database: await openDatabase(),
        identity,
        dependencies,
        signal,
        observer,
        onRegistry(owner, registry) {
          sourceOwner = owner;
          registered.set(key(owner.sessionId, owner.requestId), {
            owner,
            registry,
          });
          readers.register({ owner, registry, isCurrent: current });
        },
      });
      if (!sourceOwner) throw new Error('Cold readers unavailable.');
      return result.status === 'completed'
        ? { status: result.status, outcome: result.outcome, sourceOwner }
        : result;
    },
    async captureToolSources(
      event: ConversationToolEvent,
      sessionId: string,
      requestId: string,
    ) {
      const value = await entry(event, sessionId, requestId);
      return captureConversationToolSources(
        event,
        value.registry,
        createConversationArtifactStorage(await openDatabase()),
        sessionId,
      );
    },
    async onToolEventStored(
      event: ConversationToolEvent,
      sessionId: string,
      requestId: string,
    ) {
      if (
        !event.sources.some(source => source.sourceKind === 'external_medical')
      )
        return;
      const value = await entry(event, sessionId, requestId);
      await bindLiveConversationToolSources(
        event,
        sessionId,
        createConversationArtifactStorage(await openDatabase()),
        await dependencies.loadLocalData(),
        value.registry,
      );
    },
  };
}
