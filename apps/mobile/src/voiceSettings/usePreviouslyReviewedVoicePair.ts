import { useEffect, useRef } from 'react';
import { loadLiveResponsesSettings } from './liveResponsesSettings';
import type { LiveResponsesBackend } from './liveResponsesSettingsIdentity';
import { voiceSettingsStore } from './voiceSettingsStore';

/** Restoring verified choices only affects form presentation. It cannot create
 * a new grant or change storage. A newer explicit draft always wins. */
export function usePreviouslyReviewedVoicePair(input: {
  revision: number | null;
  eligible: boolean;
  hasDraft: boolean;
  allowed: readonly LiveResponsesBackend[];
  restore: (revision: number, backend: LiveResponsesBackend) => void;
}) {
  const live = useRef(input);
  live.current = input;
  const { revision, eligible } = input;
  useEffect(() => {
    if (revision === null || !eligible) return;
    let active = true;
    void loadLiveResponsesSettings()
      .then(settings => {
        const latest = live.current;
        if (
          !active ||
          !latest.eligible ||
          latest.hasDraft ||
          latest.revision !== revision ||
          !voiceSettingsStore.accountRevisionMatches(revision) ||
          settings.kind !== 'active' ||
          !settings.current() ||
          !latest.allowed.includes(settings.nativeGrant.backendModel)
        )
          return;
        latest.restore(revision, settings.nativeGrant.backendModel);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [revision, eligible]);
}
