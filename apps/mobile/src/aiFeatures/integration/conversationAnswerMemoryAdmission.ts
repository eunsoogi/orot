import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import type { RagConversationObserver } from '../../ragConversation/service';
import { watchEncounterNativeAdmission } from '../../encounterReview/nativeAdmission';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { ArchivedConversationAnswerTarget } from '../../ragConversation/archivedConversationAnswerTarget';
import { observeAnswerMemoryProviderOwner } from './conversationAnswerMemoryProviderOwner';

/** Archived action selection requires the positively owned local Apple model;
 * the independent existing remote history policy does not grant a write. */
function archivedAnswerMemoryLocalOwner(observer?: RagConversationObserver) {
  const model = observer?.expectedConversationModel;
  const proof = observer?.templateProposalOwner;
  return model?.providerId === APPLE_PROVIDER_ID &&
    proof?.providerId === model.providerId &&
    proof.modelId === model.modelId &&
    proof.current()
    ? proof
    : undefined;
}

/** The older live action requires existing admitted ID evidence;
 * an archive claim instead needs the exact local provider and terminal receipt. */
function canSelectAnswerMemoryArchive(
  archived: ArchivedConversationAnswerTarget | null | undefined,
  localOwner: ReturnType<typeof archivedAnswerMemoryLocalOwner>,
  remoteOwner:
    Parameters<typeof observeAnswerMemoryProviderOwner>[0] | undefined,
  terminalRunId: string | undefined,
) {
  return Boolean(
    archived &&
    !remoteOwner &&
    terminalRunId &&
    localOwner &&
    archived.current(),
  );
}

export function answerMemorySelection(input: {
  observer?: RagConversationObserver;
  remoteOwner?: Parameters<typeof observeAnswerMemoryProviderOwner>[0];
  terminalRunId?: string;
  onDeviceArchiveEligible?: boolean;
  admittedAnswerIds: ReadonlySet<string>;
}) {
  const { observer, remoteOwner, terminalRunId, admittedAnswerIds } = input;
  const archived = observer?.archivedAnswerMemoryTarget;
  const target =
    archived === undefined ? observer?.retainedHistory?.at(-1) : archived;
  const providerOwner = archived
    ? archivedAnswerMemoryLocalOwner(observer)
    : remoteOwner;
  const eligible =
    target &&
    (archived
      ? input.onDeviceArchiveEligible === true &&
        canSelectAnswerMemoryArchive(
          archived,
          providerOwner,
          remoteOwner,
          terminalRunId,
        )
      : admittedAnswerIds.has(target.id));
  return { archived, target, providerOwner, eligible };
}

/** An archived selection additionally owns a fresh, revocable foreground
 * protected-data lease. No unlock or background return revives an old tap. */
export function conversationAnswerMemoryAdmission(
  owner: Parameters<typeof observeAnswerMemoryProviderOwner>[0] | undefined,
  target: ArchivedConversationAnswerTarget | undefined,
  request: AbortSignal,
) {
  const provider = owner
    ? observeAnswerMemoryProviderOwner(owner, request)
    : undefined;
  const execution = target ? conversationExecutionNative() : null;
  const native = target
    ? watchEncounterNativeAdmission(execution, request, target.current)
    : undefined;
  return {
    signal: native?.signal ?? request,
    isCurrent: () =>
      !request.aborted &&
      (!provider || provider.isCurrent()) &&
      (!target ||
        Boolean(
          native &&
          !native.signal.aborted &&
          execution?.currentPhase?.() === 'active' &&
          target.current(),
        )),
    async recheck() {
      return (
        (!provider || (await provider.recheck())) &&
        (!target || (await native?.confirm()) === true)
      );
    },
    dispose() {
      provider?.dispose();
      native?.dispose();
    },
  };
}
