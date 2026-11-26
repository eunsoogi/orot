import { AppState, NativeModules } from 'react-native';
import type { SqlDatabase } from '@orot/storage';
import type { observeFixtureConversationLease } from './conversationLeaseProbeObservation';

type FixtureLease = Awaited<
  ReturnType<
    ReturnType<typeof observeFixtureConversationLease>['requireActive']
  >
>;
type BackgroundOwner = Readonly<{
  requestId: string;
  nativeLease: FixtureLease;
}>;

export const backgroundQuestion = 'Synthetic background question';
const settingsManager = NativeModules.SettingsManager;
const settings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const nativeExecution = NativeModules.ConversationExecutionModule as {
  isActive(id: string): Promise<boolean>;
  signalBackgroundCommit(id: string, token: string): Promise<boolean>;
  backgroundContinuedGrant?(id: string, token: string): Promise<string | null>;
  signalContinuedBackgroundCommit?(
    id: string,
    token: string,
    grant: string,
  ): Promise<boolean>;
  signalBackgroundFailure(token: string): void;
};

/** Both the runner and the native test fixture require this explicit opt-in. */
export function continuedBackgroundProbeEnabled() {
  return settings.OROT_TEST_CONTINUED_GRANT === '1';
}

/** Failure wakes the test host; the signal itself is never a completion oracle. */
export function signalBackgroundFailure() {
  if (typeof settings.OROT_TEST_BACKGROUND_TOKEN === 'string')
    nativeExecution?.signalBackgroundFailure?.(
      settings.OROT_TEST_BACKGROUND_TOKEN,
    );
}

export function observeBackground(finish: () => void) {
  return AppState.addEventListener('change', state => {
    if (state === 'background') finish();
  });
}

/** Keep the synthetic sender pending while UIKit owns the short lease. A refusal,
 * protected lock, resumed app, abort, or timeout cannot qualify as a grant. */
async function waitForContinuedGrant(
  owner: BackgroundOwner,
  token: string,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + 90_000;
  while (
    !signal?.aborted &&
    owner.nativeLease.current() &&
    AppState.currentState === 'background' &&
    Date.now() < deadline
  ) {
    const grant = await nativeExecution.backgroundContinuedGrant?.(
      owner.nativeLease.id,
      token,
    );
    if (
      grant &&
      owner.nativeLease.current() &&
      !signal?.aborted &&
      AppState.currentState === 'background'
    )
      return grant;
    await new Promise<void>(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Continued grant unavailable after short lease.');
}

/** Observe the request's real lease and app phase immediately before the commit. */
export async function beforeBackgroundCommit(
  db: SqlDatabase,
  owner: BackgroundOwner,
  signal?: AbortSignal,
) {
  const rows = (
    await db.execute(
      "SELECT id FROM conversation_requests WHERE status = 'active'",
    )
  ).rows;
  if (
    rows.length !== 1 ||
    rows[0]?.id !== owner.requestId ||
    !owner.nativeLease.current()
  )
    throw new Error('Synthetic request identity unavailable.');
  const lease = await nativeExecution.isActive(owner.nativeLease.id);
  if (!owner.nativeLease.current() || signal?.aborted)
    throw new Error('Synthetic native lease owner changed.');
  return {
    owner,
    phase: AppState.currentState ?? 'unknown',
    lease,
    continuedGrant:
      signal &&
      continuedBackgroundProbeEnabled() &&
      typeof settings.OROT_TEST_BACKGROUND_TOKEN === 'string'
        ? await waitForContinuedGrant(
            owner,
            settings.OROT_TEST_BACKGROUND_TOKEN,
            signal,
          )
        : undefined,
  };
}

/** Reject a missing bridge, token, foreground state or native lease before leaving the app. */
export async function preflightBackgroundCommit(
  db: SqlDatabase,
  requestId: string | undefined,
  witness: ReturnType<typeof observeFixtureConversationLease>,
  signal?: AbortSignal,
) {
  const token = settings.OROT_TEST_BACKGROUND_TOKEN;
  if (
    typeof token !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(token) ||
    typeof nativeExecution?.isActive !== 'function' ||
    typeof nativeExecution.signalBackgroundCommit !== 'function' ||
    typeof nativeExecution.signalBackgroundFailure !== 'function' ||
    (continuedBackgroundProbeEnabled() &&
      (typeof nativeExecution.backgroundContinuedGrant !== 'function' ||
        typeof nativeExecution.signalContinuedBackgroundCommit !== 'function'))
  )
    throw new Error('Background probe bridge unavailable.');
  if (!requestId) throw new Error('Synthetic request identity unavailable.');
  const owner = { requestId, nativeLease: await witness.requireActive(signal) };
  const before = await beforeBackgroundCommit(db, owner);

  if (before.phase !== 'active' || !before.lease)
    throw new Error('Background probe lease unavailable.');
  return owner;
}

/** Require both React Native phase observations and a still-active native lease after commit. */
export async function afterBackgroundCommit(
  db: SqlDatabase,
  before: Awaited<ReturnType<typeof beforeBackgroundCommit>>,
  stayedBackground = () => true,
) {
  const { requestId, nativeLease } = before.owner;
  if (!nativeLease.current()) {
    signalBackgroundFailure();
    return;
  }
  const after = AppState.currentState ?? 'unknown';
  const token = settings.OROT_TEST_BACKGROUND_TOKEN;
  const continued = continuedBackgroundProbeEnabled();
  const grantAfter =
    continued && typeof token === 'string'
      ? await nativeExecution.backgroundContinuedGrant?.(nativeLease.id, token)
      : undefined;
  const leaseAfter = continued
    ? !!before.continuedGrant && before.continuedGrant === grantAfter
    : await nativeExecution.isActive(nativeLease.id);
  if (!nativeLease.current()) {
    signalBackgroundFailure();
    return;
  }
  await db.execute(
    'INSERT INTO conversation_retention_probe_background VALUES (?, ?, ?, ?, ?)',
    [requestId, before.phase, after, before.lease ? 1 : 0, leaseAfter ? 1 : 0],
  );
  if (
    before.phase === 'background' &&
    after === 'background' &&
    before.lease &&
    leaseAfter &&
    AppState.currentState === 'background' &&
    stayedBackground() &&
    nativeLease.current() &&
    typeof token === 'string'
  ) {
    const signalled = continued
      ? !!before.continuedGrant &&
        (await nativeExecution.signalContinuedBackgroundCommit?.(
          nativeLease.id,
          token,
          before.continuedGrant,
        ))
      : await nativeExecution.signalBackgroundCommit(nativeLease.id, token);
    if (signalled) return;
  }
  signalBackgroundFailure();
}
