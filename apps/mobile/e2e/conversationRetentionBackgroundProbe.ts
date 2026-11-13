import { AppState, NativeModules } from 'react-native';
import type { SqlDatabase } from '@orot/storage';

export const backgroundQuestion = 'Synthetic background question';
const settingsManager = NativeModules.SettingsManager;
const settings =
  settingsManager?.settings ?? settingsManager?.getConstants?.().settings ?? {};
const nativeExecution = NativeModules.ConversationExecutionModule as {
  isActive(id: string): Promise<boolean>;
  signalBackgroundCommit(id: string, token: string): Promise<boolean>;
  signalBackgroundFailure(token: string): void;
};

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

/** Observe the request's real lease and app phase immediately before the commit. */
export async function beforeBackgroundCommit(db: SqlDatabase) {
  const rows = (
    await db.execute(
      "SELECT id FROM conversation_requests WHERE status = 'active'",
    )
  ).rows;
  if (rows.length !== 1 || typeof rows[0]?.id !== 'string')
    throw new Error('Synthetic request identity unavailable.');
  const requestId = rows[0].id;
  return {
    requestId,
    phase: AppState.currentState ?? 'unknown',
    lease: await nativeExecution.isActive(requestId),
  };
}

/** Reject a missing bridge, token, foreground state or native lease before leaving the app. */
export async function preflightBackgroundCommit(db: SqlDatabase) {
  const token = settings.OROT_TEST_BACKGROUND_TOKEN;
  if (
    typeof token !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(token) ||
    typeof nativeExecution?.isActive !== 'function' ||
    typeof nativeExecution.signalBackgroundCommit !== 'function' ||
    typeof nativeExecution.signalBackgroundFailure !== 'function'
  )
    throw new Error('Background probe bridge unavailable.');
  const before = await beforeBackgroundCommit(db);
  if (before.phase !== 'active' || !before.lease)
    throw new Error('Background probe lease unavailable.');
}

/** Require both React Native phase observations and a still-active native lease after commit. */
export async function afterBackgroundCommit(
  db: SqlDatabase,
  before: Awaited<ReturnType<typeof beforeBackgroundCommit>>,
) {
  const after = AppState.currentState ?? 'unknown';
  const leaseAfter = await nativeExecution.isActive(before.requestId);
  await db.execute(
    'INSERT INTO conversation_retention_probe_background VALUES (?, ?, ?, ?, ?)',
    [
      before.requestId,
      before.phase,
      after,
      before.lease ? 1 : 0,
      leaseAfter ? 1 : 0,
    ],
  );
  if (
    before.phase === 'background' &&
    after === 'background' &&
    before.lease &&
    leaseAfter &&
    typeof settings.OROT_TEST_BACKGROUND_TOKEN === 'string'
  ) {
    if (
      await nativeExecution.signalBackgroundCommit(
        before.requestId,
        settings.OROT_TEST_BACKGROUND_TOKEN,
      )
    )
      return;
  }
  signalBackgroundFailure();
}
