import {
  IOS_LIBRARY_PATH,
  isSQLCipher,
  open,
  type DB,
} from '@op-engineering/op-sqlite';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  readSelectedOverviewProjection,
  type SelectedOverviewSnapshot,
} from '../routes/overview/selectedOverviewSnapshot';
import { acquireIndependentReadEpoch } from './protectedReadEpoch';
import {
  readIndependentOverviewSnapshot,
  type OverviewReadOutcome,
} from '../routes/overview/independentOverviewSnapshot';

/** The key-capable secure opener calls this narrow chart reader only after
 * existing writer initialization. No source/agent repository is exposed. */
async function readSecureOverviewProjection(input: {
  owner: DB;
  ownerIsCurrent: () => boolean;
  open: () => DB;
  now: Date;
  signal: AbortSignal;
  publish: (value: SelectedOverviewSnapshot) => void;
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
      tx => readSelectedOverviewProjection(tx, input.now),
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
  return async (
    now: Date,
    signal: AbortSignal,
    publish: (value: SelectedOverviewSnapshot) => void,
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
      now,
      signal,
      publish,
    });
  };
}
