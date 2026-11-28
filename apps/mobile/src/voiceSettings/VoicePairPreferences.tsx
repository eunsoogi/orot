import { useMemo, type ComponentProps } from 'react';
import {
  LiveVoicePreferencesPanel,
  type LiveVoicePreferencesDraft,
} from './LiveVoicePreferencesPanel';
import { SavedLiveVoicePreferences } from './SavedLiveVoicePreferences';
import type { LiveResponsesSettings } from './liveResponsesSettings';
import { openAiVoicePreferencesDraftReader } from './openAiVoiceFormRead';

/** A stale catalog can show committed preferences, but it cannot stage an edit. */
export function VoicePairPreferences({
  revision,
  saved,
  cached,
  editable,
  busy,
  override,
  onDraftChange,
}: {
  readonly revision: number;
  readonly saved?: Extract<LiveResponsesSettings, { kind: 'active' }>;
  readonly cached: boolean;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly override?: ComponentProps<typeof LiveVoicePreferencesPanel>;
  readonly onDraftChange: (draft: LiveVoicePreferencesDraft | null) => void;
}) {
  const reader = useMemo(
    () => openAiVoicePreferencesDraftReader(revision),
    [revision],
  );
  if (!editable)
    return cached ? <SavedLiveVoicePreferences settings={saved} /> : null;
  return (
    <LiveVoicePreferencesPanel
      key={revision}
      onDraftChange={onDraftChange}
      busy={busy}
      {...(override ?? {
        ready: true,
        store: reader,
        authorityRevision: revision,
      })}
    />
  );
}
