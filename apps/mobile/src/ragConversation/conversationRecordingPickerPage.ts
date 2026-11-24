import type { Dispatch, SetStateAction } from 'react';
import {
  loadRecentSourceMaterial,
  type RecentMediaRow,
} from '../routes/recentSourceReader';
import { conversationExecutionNative } from './conversationExecutionNative';

export type RecordingPickerState = {
  readonly rows: readonly RecentMediaRow[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly more: boolean;
};

export async function currentRecordingProtection() {
  try {
    const native = conversationExecutionNative();
    return Boolean(
      native?.bridgeAvailable &&
      (await native.protectedDataAvailable()) === true,
    );
  } catch {
    return false;
  }
}

export const emptyRecordingPage: RecordingPickerState = {
  rows: [],
  loading: false,
  failed: false,
  more: false,
};

export type RecordingPickerRequest = {
  readonly controller: AbortController;
  tail?: RecentMediaRow;
  pending: boolean;
  rows: readonly RecentMediaRow[];
};

/** Reuse only the bounded committed metadata index, with no transcript or audio browse access. */
export async function requestRecordingPickerPage(
  owner: RecordingPickerRequest,
  sameOwner: () => boolean,
  setPage: Dispatch<SetStateAction<RecordingPickerState>>,
) {
  if (owner.pending || !sameOwner()) return;
  const same = () => sameOwner() && !owner.controller.signal.aborted;
  const protectedNow = async () =>
    same() && (await currentRecordingProtection()) && same();
  owner.pending = true;
  setPage(previous => ({ ...previous, loading: true, failed: false }));
  try {
    if (!(await protectedNow())) {
      if (same()) {
        owner.rows = [];
        owner.tail = undefined;
        setPage({ ...emptyRecordingPage, failed: true });
      }
      return;
    }
    const rows = await loadRecentSourceMaterial(owner.tail, {
      signal: owner.controller.signal,
      canRetry: protectedNow,
    });
    if (!(await protectedNow())) {
      if (same()) {
        owner.rows = [];
        owner.tail = undefined;
        setPage({ ...emptyRecordingPage, failed: true });
      }
      return;
    }
    // Page the real mixed index. No transcript/history scan or background fetch is used.
    owner.tail = rows.at(-1) ?? owner.tail;
    owner.rows = [
      ...owner.rows,
      ...rows.filter(row => row.kind === 'audio_recording'),
    ];
    setPage({
      rows: owner.rows,
      loading: false,
      failed: false,
      more: rows.length === 20,
    });
  } catch {
    if (same()) {
      // An indeterminate unlock check must not leave previously published names visible.
      owner.rows = [];
      owner.tail = undefined;
      setPage({ ...emptyRecordingPage, failed: true });
    }
  } finally {
    owner.pending = false;
  }
}
