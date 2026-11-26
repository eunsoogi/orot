import { useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { watchEncounterNativeAdmission } from '../encounterReview/nativeAdmission';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { conversationExecutionNative } from './conversationExecutionNative';
import { ConversationA2UILocalDraftOwner } from './conversationA2UILocalDraftOwner';
import { ConversationA2UISurface } from './ConversationA2UISurface';
import { archivedRichTextDisplayBinding } from './archivedRichTextDisplayBinding';
import type { ConversationA2UINode } from './conversationA2UI';

/** Confirm native foreground and the existing selected-page revision before
 * displaying any recalled rich text. No automatic SQLite read or retry. */
export function ArchivedRichTextSurface({
  root,
  testID,
}: {
  root: ConversationA2UINode;
  testID?: string;
}) {
  const binding = archivedRichTextDisplayBinding(root);
  const owner = useContext(ConversationA2UILocalDraftOwner);
  const [receipt, setReceipt] = useState<{
    root: ConversationA2UINode;
    owner: typeof owner;
    signal: AbortSignal;
  }>();
  const current = () =>
    binding?.revision.current() === true &&
    owner?.hasArchive?.(root, binding.lease) === true &&
    AppState.currentState === 'active';
  useEffect(() => {
    const isCurrent = () =>
      binding?.revision.current() === true &&
      owner?.hasArchive?.(root, binding.lease) === true &&
      AppState.currentState === 'active';
    if (!binding || !owner || !isCurrent()) return;
    const controller = new AbortController();
    const retire = () => controller.abort();
    const stopRevision = binding.revision.watch(retire);
    if (!stopRevision) return;
    const native = watchEncounterNativeAdmission(
      conversationExecutionNative(),
      controller.signal,
      isCurrent,
    );
    const stopOwner = owner.subscribe(() => {
      if (!isCurrent()) retire();
    });
    const stopClear = subscribeLocalDataClear(retire);
    const stopDelete = subscribeLocalSourceDeletion(retire);
    const invalidate = () => {
      retire();
      setReceipt(undefined);
    };
    native?.signal.addEventListener('abort', invalidate, { once: true });
    const release = () => {
      stopRevision();
      stopOwner();
      stopClear();
      stopDelete();
    };
    controller.signal.addEventListener('abort', release, { once: true });
    if (!native || native.signal.aborted) retire();
    else {
      native.confirm().then(ok => {
        if (
          ok &&
          !native.signal.aborted &&
          !controller.signal.aborted &&
          isCurrent()
        )
          setReceipt({ root, owner, signal: native.signal });
        else retire();
      });
    }
    return () => {
      native?.signal.removeEventListener('abort', invalidate);
      retire();
    };
  }, [binding, owner, root]);
  return receipt?.root === root &&
    receipt.owner === owner &&
    !receipt.signal.aborted &&
    current() ? (
    <ConversationA2UISurface root={root} testID={testID} />
  ) : null;
}
