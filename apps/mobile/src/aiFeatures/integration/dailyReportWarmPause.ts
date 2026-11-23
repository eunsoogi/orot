import { dailyReportWarmProviderGuard } from './dailyReportWarmProviderGuard';
import { readDailyReportWarmSettingsOwner } from '../../agent/execution/dailyReportWarmSettingsOwner';
import { fingerprint } from './evidenceUtils';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { DailyReportWarmCheckpointIdentity } from '../../storage/dailyReportPreDispatchCheckpoint';
import type { createDailyReportWarmCheckpoint } from '../../storage/dailyReportPreDispatchCheckpoint';
import type { DailyReportServiceRequest } from './dailyReportTypes';
import type { SelectedAiResolution } from './provider';
import type { DailyReportSnapshotResult } from '../../healthEvidence/healthContext/dailyReportSnapshotResult';

type CheckpointFactory = (
  identity: DailyReportWarmCheckpointIdentity,
) => ReturnType<typeof createDailyReportWarmCheckpoint>;

/** Operates only before either report or opening owns a provider dispatch. */
export async function dailyReportWarmPause(input: {
  readonly request: DailyReportServiceRequest;
  readonly selected: Extract<SelectedAiResolution, { status: 'ready' }>;
  readonly initial: DailyReportSnapshotResult;
  readonly checkpoint: CheckpointFactory | undefined;
  readonly reproof: () => Promise<DailyReportSnapshotResult | null>;
  readonly fingerprint: string;
  readonly dayCurrent: () => boolean;
}): Promise<boolean | Extract<SelectedAiResolution, { status: 'ready' }>> {
  const { request, selected } = input;
  const observer = request.observer;
  const session = observer?.retentionSession;
  const requestId = observer?.retentionRequestId;
  if (
    !input.checkpoint ||
    observer?.photoInput ||
    !session ||
    !requestId ||
    !observer?.onWorkflowPauseController ||
    !observer.onWorkflowPaused ||
    !selected.remoteProcessing
  )
    return true;
  let settingsOwner: Awaited<
    ReturnType<typeof readDailyReportWarmSettingsOwner>
  >;
  const current = () =>
    !request.signal.aborted &&
    input.dayCurrent() &&
    (!settingsOwner || settingsOwner.isCurrent());
  let pauseRequested = false;
  observer.onWorkflowPauseController(() => {
    pauseRequested = true;
  });
  if (!pauseRequested) return true;

  const native = conversationExecutionNative();
  if (!native?.bridgeAvailable || !current()) return false;
  const eligible = async () =>
    current() && (await native.protectedDataAvailable()) === true && current();

  try {
    if (!(await eligible())) return false;
    settingsOwner = await readDailyReportWarmSettingsOwner(
      selected.provider.id,
      selected.modelId,
      selected.recipient,
      request.signal,
    );
    if (!settingsOwner || !(await eligible())) return false;
    const checkpoint = input.checkpoint({
      requestId,
      sessionId: session.id,
      sessionVersion: session.version,
      fingerprint: fingerprint([input.fingerprint, settingsOwner.identity]),
    });
    if (
      !(await checkpoint.arm(current)) ||
      !(await checkpoint.pause(current)) ||
      !(await observer.onWorkflowPaused('background-paused'))
    )
      return false;
    const foreground = () => current() && AppState.currentState === 'active';
    if (!foreground() || !(await eligible())) return false;
    const renewed = await readDailyReportWarmSettingsOwner(
      selected.provider.id,
      selected.modelId,
      selected.recipient,
      request.signal,
    );
    if (
      !renewed ||
      renewed.identity !== settingsOwner.identity ||
      !renewed.isCurrent()
    )
      return false;
    const refreshed = await input.reproof();
    if (
      !refreshed ||
      refreshed.sourceSnapshot.deletionGeneration !==
        input.initial.sourceSnapshot.deletionGeneration ||
      !foreground() ||
      !(await eligible())
    )
      return false;
    // The one-use SQLite claim is consumed before either opening/final may start;
    // both still pass independent current Settings consent at real dispatch.
    if (
      !(await checkpoint.claim(foreground)) ||
      !(await checkpoint.markDispatchPossible(
        foreground,
        refreshed.sourceSnapshot,
      )) ||
      !(await eligible()) ||
      !foreground()
    )
      return false;
    // Foreground is required to start Continue. Thereafter its own lifetime
    // signal and protected-data proof, not AppState, fence permitted background.
    const dispatch = async () =>
      (await eligible()) &&
      (await checkpoint.dispatchStillCurrent(
        current,
        refreshed.sourceSnapshot,
      )) &&
      (await eligible());
    const provider = dailyReportWarmProviderGuard(
      selected.provider,
      current,
      dispatch,
    );
    return { ...selected, provider, option: { ...selected.option, provider } };
  } catch {
    return false;
  }
}
