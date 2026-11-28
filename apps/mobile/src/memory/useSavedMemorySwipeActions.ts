import { useLayoutEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { watchEncounterNativeAdmission } from '../encounterReview/nativeAdmission';
import { t } from '../i18n';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { isHistoryMemory, type SavedMemory } from './unifiedSavedMemories';
import type { useSavedMemories } from './useSavedMemories';

type Read = NonNullable<ReturnType<typeof useSavedMemories>['readyRead']>;
type Protection = NonNullable<ReturnType<typeof watchEncounterNativeAdmission>>;
type Target = { read: Read; started?: true; protection?: Protection };

/** One confirmation per current list read, including while the native alert is open. */
export function useSavedMemorySwipeActions({
  read,
  owner,
  refresh,
}: {
  read: Read | null;
  owner?: NavigationRouteOwnership;
  refresh: () => Promise<void>;
}) {
  const [working, setWorking] = useState<Target>();
  const [failure, setFailure] = useState<{ read: Read; message: string }>();
  const pending = useRef<Target | undefined>(undefined);
  const latest = useRef(read);
  latest.current = read;
  useLayoutEffect(() => {
    return () => {
      const target = pending.current;
      if (!target || target.read !== read) return;
      pending.current = undefined;
      target.protection?.dispose();
    };
  }, [read]);

  const current = (target: Target) =>
    pending.current === target &&
    latest.current === target.read &&
    owner?.isCurrent() === true &&
    target.read.isCurrent();

  function claim(row: SavedMemory) {
    if (!read?.isCurrent() || owner?.isCurrent() !== true || pending.current)
      return;
    if (!read.rows.includes(row)) return;
    const target: Target = { read };
    pending.current = target;
    const protection = watchEncounterNativeAdmission(
      conversationExecutionNative(),
      new AbortController().signal,
      () => current(target),
    );
    if (!protection || protection.signal.aborted) {
      release(target);
      return;
    }
    target.protection = protection;
    protection.signal.addEventListener('abort', () => release(target), {
      once: true,
    });
    setWorking(target);
    setFailure(undefined);
    return target;
  }

  function release(target: Target) {
    if (pending.current !== target) return;
    pending.current = undefined;
    target.protection?.dispose();
    setWorking(undefined);
  }

  async function perform(
    target: Target,
    work: (protection: Protection) => Promise<void>,
  ) {
    if (target.started) return;
    if (!current(target)) return release(target);
    target.started = true;
    const protection = target.protection;
    try {
      if (!protection || !(await protection.confirm())) return;
      await work(protection);
    } catch {
      if (current(target) && !protection?.signal.aborted)
        setFailure({
          read: target.read,
          message: t('manualHistory.error.delete'),
        });
    } finally {
      release(target);
    }
  }

  function requestDelete(row: SavedMemory) {
    if (!isHistoryMemory(row)) return;
    const target = claim(row);
    if (!target) return;
    const cancel = () => {
      if (!target.started) release(target);
    };
    Alert.alert(
      t('manualHistory.detail.delete'),
      t('manualHistory.detail.confirmDelete'),
      [
        {
          text: t('manualHistory.detail.cancelDelete'),
          style: 'cancel',
          onPress: cancel,
        },
        {
          text: t('manualHistory.detail.confirmDeleteAction'),
          style: 'destructive',
          onPress: () =>
            perform(target, async protection => {
              const { openLocalCurrentHistoryDeletion } =
                require('../manualHistory/localRepository') as typeof import('../manualHistory/localRepository');
              const repository = await openLocalCurrentHistoryDeletion();
              if (!(await protection.confirm())) return;
              const canDelete = () =>
                current(target) && !protection.signal.aborted;
              if (!(await repository.deleteCurrent(row.record.id, canDelete)))
                throw new Error('Selected history is no longer current.');
              if (canDelete()) await refresh();
            }),
        },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  }

  return {
    busy: !!working && working.read === read,
    error: failure && failure.read === read ? failure.message : undefined,
    requestDelete,
  };
}
