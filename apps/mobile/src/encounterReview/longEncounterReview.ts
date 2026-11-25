import {
  encounterCanonical,
  requireEncounterActive,
  validateEncounterApproval,
  validateEncounterCandidates,
} from '@orot/agent-runtime';
import type {
  EncounterApproval,
  EncounterPending,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import { providerSelectionStore } from '../providers/selection/keychainSelectionStore';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { acquireIndependentReadEpoch } from '../storage/protectedReadEpoch';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { encounterConflicts } from '../agent/encounter/conflicts';
import { persistEncounterApproval } from '../agent/encounter/persistence';
import { readLongTranscriptReview } from '../agent/encounter/longTranscriptReviewRead';
import type { ReviewResult } from './controller';
import { prepareLocalEncounterExtraction } from './localEncounterPageExtraction';
import { watchEncounterNativeAdmission } from './nativeAdmission';
import { openEncounterReviewSessions } from './openSessions';

type Owner = {
  pending?: EncounterPending;
  readonly lease: NonNullable<ReturnType<typeof watchEncounterNativeAdmission>>;
};

export function createLongEncounterReview(
  resolve: typeof resolveSelectedAiProvider,
) {
  const owners = new Map<string, Owner>();
  return {
    async start(
      sourceId: string,
      repository: RecordRepository,
      consent: ExecutionConsentPort,
      signal: AbortSignal,
      lifetime: AbortSignal,
    ): Promise<ReviewResult> {
      // Do not contact account/catalog services when the private long route cannot be used.
      const choice = await providerSelectionStore.load();
      if (signal.aborted || lifetime.aborted) return { status: 'cancelled' };
      if (choice?.providerId !== APPLE_PROVIDER_ID)
        return { status: 'transcript-too-long' };
      const selected = await resolve();
      if (selected.status !== 'ready') return { status: selected.status };
      const witness = selected.onDeviceSelectionWitness;
      if (
        selected.remoteProcessing ||
        !witness?.isCurrent() ||
        selected.modelId !== choice.modelId
      )
        return { status: 'unavailable' };

      const native = conversationExecutionNative();
      const prior = owners.get(sourceId);
      prior?.lease.dispose();
      const lease = watchEncounterNativeAdmission(native, lifetime, () =>
        witness.isCurrent(),
      );
      if (!lease) return { status: 'unavailable' };
      const operation: Owner = { lease };
      owners.set(sourceId, operation);
      const cancel = () => lease.dispose();
      signal.addEventListener('abort', cancel, { once: true });
      let unsubscribeSelection: (() => void) | undefined;
      let published = false;
      lease.signal.addEventListener(
        'abort',
        () => {
          if (owners.get(sourceId)?.lease === lease) owners.delete(sourceId);
          unsubscribeSelection?.();
        },
        { once: true },
      );
      try {
        unsubscribeSelection = witness.subscribe(() => {
          if (!witness.isCurrent()) lease.dispose();
        });
        if (lease.signal.aborted) unsubscribeSelection();
        if (!(await lease.confirm()) || signal.aborted)
          return { status: 'unavailable' };
        const database = await openLocalAgentMemoryDatabase();
        const executionId = Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          byte => byte.toString(16).padStart(2, '0'),
        ).join('');
        const result = await prepareLocalEncounterExtraction({
          read: {
            database,
            sourceId,
            signal: lease.signal,
            native,
            ownerCurrent: () =>
              !signal.aborted && !lifetime.aborted && witness.isCurrent(),
          },
          selected,
          consent,
          executionId: 'encounter-local-long-' + executionId,
        });
        if (signal.aborted) return { status: 'cancelled' };
        if (result.status !== 'complete') return { status: 'unavailable' };
        if (result.candidates.length > 32) return { status: 'review-capacity' };
        const { discovery } = await openEncounterReviewSessions(sourceId);
        if (!(await lease.confirm()) || signal.aborted)
          return { status: 'unavailable' };
        const session = await discovery.begin(lease.signal);
        const epoch = acquireIndependentReadEpoch(database);
        if (!epoch) return { status: 'unavailable' };
        let pending: EncounterPending;
        try {
          const dataVersion = async () =>
            (await database.execute('PRAGMA data_version')).rows[0]
              ?.data_version;
          const version = await dataVersion();
          if (typeof version !== 'number') return { status: 'unavailable' };
          pending = await repository.transaction(async (writer, sql) => {
            if (!sql) throw new Error('Canonical storage required.');
            const snapshot: EncounterPending = {
              threadId: session.threadId,
              sourceId,
              segments: result.segments,
              candidates: result.candidates,
              conflicts: [],
            };
            const transcript = await readLongTranscriptReview(
              writer,
              sql,
              snapshot,
              () => requireEncounterActive(lease.signal),
            );
            validateEncounterCandidates(snapshot.candidates, transcript);
            snapshot.conflicts = await encounterConflicts(
              writer,
              snapshot.candidates,
            );
            return snapshot;
          });
          if (
            (await discovery.read())?.threadId !== pending.threadId ||
            !(await lease.confirm()) ||
            signal.aborted
          )
            return { status: 'unavailable' };
          if (
            (await dataVersion()) !== version ||
            !epoch.current() ||
            lease.signal.aborted
          )
            return { status: 'unavailable' };
        } finally {
          epoch.dispose();
        }
        operation.pending = pending;
        published = true;
        return { status: 'pending', pending, retireSignal: lease.signal };
      } finally {
        signal.removeEventListener('abort', cancel);
        if (!published) lease.dispose();
      }
    },
    async decide(
      sourceId: string,
      approval: EncounterApproval,
      signal: AbortSignal,
    ): Promise<ReviewResult | undefined> {
      const owner = owners.get(sourceId);
      const pending = owner?.pending;
      if (!owner || !pending || approval.pending.threadId !== pending.threadId)
        return undefined;
      const decision = JSON.parse(
        JSON.stringify(approval),
      ) as EncounterApproval;
      const stop = () => owner.lease.dispose();
      signal.addEventListener('abort', stop, { once: true });
      try {
        if (signal.aborted || !(await owner.lease.confirm()))
          return { status: signal.aborted ? 'cancelled' : 'unavailable' };
        if (
          encounterCanonical(decision.pending) !== encounterCanonical(pending)
        )
          return { status: 'unavailable' };
        validateEncounterApproval(pending, decision);
        if (decision.decision === 'deny') return { status: 'denied' };
        const repository = await openLocalStorage();
        if (!(await owner.lease.confirm()) || signal.aborted)
          return { status: signal.aborted ? 'cancelled' : 'unavailable' };
        const recordIds = await persistEncounterApproval(
          repository,
          pending,
          decision,
          owner.lease.signal,
          true,
          readLongTranscriptReview,
        );
        return { status: 'saved', recordIds };
      } catch {
        return { status: signal.aborted ? 'cancelled' : 'unavailable' };
      } finally {
        signal.removeEventListener('abort', stop);
        owner.lease.dispose();
      }
    },
  };
}
