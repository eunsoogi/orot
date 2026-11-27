import { matchesLocalEncounterSelection } from './localEncounterSelection';
import { admitRemoteLongEncounter } from './remoteLongEncounterAdmission';
import {
  encounterCanonical,
  validateEncounterApproval,
} from '@orot/agent-runtime';
import type {
  EncounterApproval,
  EncounterPending,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import { APPLE_PCC_PROVIDER_ID, APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import { providerSelectionStore } from '../providers/selection/keychainSelectionStore';
import { openLocalStorage } from '../storage/secureDatabase';
import { openObservedEncounterPageDatabase } from './observedPageDatabase';
import { acquireIndependentReadEpoch } from '../storage/protectedReadEpoch';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { persistEncounterApproval } from '../agent/encounter/persistence';
import { readLongTranscriptReview } from '../agent/encounter/longTranscriptReviewRead';
import type { ReviewResult } from './controller';
import { prepareLocalEncounterExtraction } from './localEncounterPageExtraction';
import { watchEncounterNativeAdmission } from './nativeAdmission';
import { openEncounterReviewSessions } from './openSessions';
import { proveLongEncounterPending } from './proveLongEncounterPending';

type Owner = {
  pending?: EncounterPending;
  readonly lease: NonNullable<ReturnType<typeof watchEncounterNativeAdmission>>;
  readonly reviewIsCurrent?: () => boolean;
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
      progress?: (completed: number) => void,
    ): Promise<ReviewResult> {
      const selectionCurrent = providerSelectionStore.liveWitness();
      const choice = await providerSelectionStore.load();
      if (signal.aborted || lifetime.aborted) return { status: 'cancelled' };
      if (!choice) return { status: 'selection-required' };
      // The native PCC adapter admits one app call per page. Leave the existing
      // short-only remote transports untouched until their replay boundary is proved.
      if (
        choice.providerId !== APPLE_PROVIDER_ID &&
        choice.providerId !== APPLE_PCC_PROVIDER_ID
      )
        return { status: 'transcript-too-long' };
      const local = choice.providerId === APPLE_PROVIDER_ID;
      const remote =
        !local && selectionCurrent?.()
          ? await admitRemoteLongEncounter({
              choice,
              selectionCurrent,
              sourceId,
              lifetime,
              signal,
              resolve,
              consent,
            })
          : undefined;
      if (signal.aborted || lifetime.aborted) return { status: 'cancelled' };
      if (!local && !remote) return { status: 'unavailable' };
      // The resolved owner may belong to a newer selection of the same model.
      // Keep the Settings epoch captured before the initial read for this Start.
      const selected = local && selectionCurrent?.() ? await resolve() : null;
      if (signal.aborted || lifetime.aborted) return { status: 'cancelled' };
      if (local && !selectionCurrent?.()) return { status: 'unavailable' };
      if (selected && selected.status !== 'ready')
        return { status: selected.status };
      const witness = remote ?? selected?.onDeviceSelectionWitness;
      const current = () =>
        (!local || selectionCurrent?.() === true) &&
        witness?.isCurrent() === true;
      if (
        !witness ||
        !current() ||
        (selected && !matchesLocalEncounterSelection(selected, choice))
      )
        return { status: 'unavailable' };
      const native = conversationExecutionNative();
      const prior = owners.get(sourceId);
      prior?.lease.dispose();
      const lease = watchEncounterNativeAdmission(native, lifetime, current);
      if (!lease) return { status: 'unavailable' };
      const operation: Owner = { lease, reviewIsCurrent: remote?.isCurrent };
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
          if (!current()) lease.dispose();
        });
        if (lease.signal.aborted) unsubscribeSelection();
        if (!(await lease.confirm()) || signal.aborted)
          return { status: 'unavailable' };
        const database = await openObservedEncounterPageDatabase(
          sourceId,
          lease,
        );
        const executionId = Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          byte => byte.toString(16).padStart(2, '0'),
        ).join('');
        const read = {
          database,
          sourceId,
          signal: lease.signal,
          native,
          ownerCurrent: () => !signal.aborted && !lifetime.aborted && current(),
        };
        const result = remote
          ? await remote.extract(
              read,
              'encounter-remote-long-' + executionId,
              progress,
            )
          : selected &&
            (await prepareLocalEncounterExtraction({
              read,
              selected,
              consent,
              progress,
              executionId: 'encounter-local-long-' + executionId,
            }));
        if (signal.aborted) return { status: 'cancelled' };
        if (
          !remote &&
          result?.status === 'invalid-candidates' &&
          !lease.signal.aborted &&
          read.ownerCurrent()
        )
          return { status: 'invalid-candidates' };
        if (result?.status !== 'complete')
          return {
            status: remote?.denied() ? 'consent-denied' : 'unavailable',
          };
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
          pending = await proveLongEncounterPending(
            repository,
            {
              threadId: session.threadId,
              sourceId,
              segments: result.segments,
              candidates: result.candidates,
              conflicts: [],
            },
            lease.signal,
          );
          if (
            (await discovery.read())?.threadId !== pending.threadId ||
            !(await lease.confirm()) ||
            signal.aborted
          )
            return { status: 'unavailable' };
          if (
            (await dataVersion()) !== version ||
            !epoch.current() ||
            !current() ||
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
          owner.reviewIsCurrent,
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
