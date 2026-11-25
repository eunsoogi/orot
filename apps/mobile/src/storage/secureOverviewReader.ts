import {
  IOS_LIBRARY_PATH,
  isSQLCipher,
  open,
  type DB,
} from '@op-engineering/op-sqlite';
import type { SqlExecutor } from '@orot/storage';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  readSelectedOverviewProjection,
  readOverviewPreferenceProof,
  type SelectedOverviewSnapshot,
} from '../routes/overview/selectedOverviewSnapshot';
import {
  selectedWorkoutChoiceProof,
  type WorkoutChoiceReceipt,
} from '../routes/overview/earlyWorkoutChoice';
import { acquireIndependentReadEpoch } from './protectedReadEpoch';
import {
  readIndependentOverviewSnapshot,
  type OverviewReadOutcome,
} from '../routes/overview/independentOverviewSnapshot';

/** The key-capable secure opener calls this narrow chart reader only after
 * existing writer initialization. No source/agent repository is exposed. */
async function readSecureOverviewProjection<T>(input: {
  owner: DB;
  ownerIsCurrent: () => boolean;
  open: () => DB;
  project: (tx: SqlExecutor) => Promise<T>;
  signal: AbortSignal;
  publish: (value: T) => void;
}): Promise<OverviewReadOutcome> {
  const protection = conversationExecutionNative();
  if (!protection?.bridgeAvailable) return 'unavailable';
  let epoch: ReturnType<typeof acquireIndependentReadEpoch>;
  let active = true;
  let unsubscribe: (() => void) | undefined;
  const current = () =>
    active &&
    !input.signal.aborted &&
    protection.currentPhase?.() === 'active' &&
    input.ownerIsCurrent() &&
    (epoch?.current() ?? true);
  const confirm = async () => {
    try {
      return (await protection.protectedDataAvailable()) === true;
    } catch {
      return false;
    }
  };
  try {
    unsubscribe = protection.subscribe(event => {
      if (
        event.kind === 'phase' ||
        (event.kind === 'protectedData' && !event.available)
      )
        active = false;
    });
    if (!current() || !(await confirm()) || !current()) return 'discarded';
    epoch = acquireIndependentReadEpoch(input.owner);
    if (!epoch) return 'unavailable';
    return await readIndependentOverviewSnapshot(
      input.open,
      current,
      confirm,
      input.project,
      input.publish,
    );
  } finally {
    epoch?.dispose();
    unsubscribe?.();
  }
}

/** Use the same noncreating credential, database name and iOS path as the
 * writer. The projection caller can neither change the open flags nor keep
 * the independently keyed handle. */
export function createSecureOverviewReader(
  readyWriter: () => Promise<unknown>,
  currentWriter: () => DB | null,
  readExistingKey: () => Promise<string | null>,
  name: string,
) {
  const run = async <T>(
    project: (tx: SqlExecutor) => Promise<T>,
    signal: AbortSignal,
    publish: (value: T) => void,
  ): Promise<OverviewReadOutcome> => {
    if (signal.aborted) return 'discarded';
    await readyWriter();
    const owner = currentWriter();
    if (!owner || !isSQLCipher()) return 'unavailable';
    let encryptionKey: string | null;
    try {
      encryptionKey = await readExistingKey();
    } catch {
      return 'discarded';
    }
    if (!encryptionKey || owner !== currentWriter() || signal.aborted)
      return 'discarded';
    const key = encryptionKey;
    return readSecureOverviewProjection({
      owner,
      ownerIsCurrent: () => currentWriter() === owner,
      open: () =>
        open({
          name,
          location: IOS_LIBRARY_PATH,
          encryptionKey: key,
          readOnly: true,
          failOnCreate: true,
        }),
      project,
      signal,
      publish,
    });
  };
  const readOverview = (
    now: Date,
    signal: AbortSignal,
    publish: (value: SelectedOverviewSnapshot) => void,
  ) => run(tx => readSelectedOverviewProjection(tx, now), signal, publish);
  const readWorkoutChoice = (
    signal: AbortSignal,
    publish: (receipt: WorkoutChoiceReceipt) => void,
  ) =>
    run(readOverviewPreferenceProof, signal, preference => {
      const receipt = selectedWorkoutChoiceProof(preference);
      if (receipt) publish(receipt);
    });
  return Object.assign(readOverview, { readWorkoutChoice });
}
