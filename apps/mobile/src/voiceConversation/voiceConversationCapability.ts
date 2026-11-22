import { liveModel } from '../voiceSettings/liveVoicePreferences';
import type { VoiceSettings } from '../voiceSettings/voiceSettingsStore';

/** Tool availability is transport-specific. "Owned workflow" is not a grant:
 * the selected model, current session and existing scopes still decide each tool.
 * A native audio module or a legacy saved ID cannot lend authority to Live. */
const selectedConversationTools = {
  records: 'owned-workflow',
  reviewedMemory: 'owned-workflow',
  publicResearch: 'owned-workflow',
  confirmedActions: 'owned-workflow',
  stagedPhotos: 'unsupported',
  protectedResultRelay: 'unsupported',
} as const;
const noTools = {
  records: 'unsupported',
  reviewedMemory: 'unsupported',
  publicResearch: 'unsupported',
  confirmedActions: 'unsupported',
  stagedPhotos: 'unsupported',
  protectedResultRelay: 'unsupported',
} as const;
const capabilities = {
  'selected-conversation': {
    mode: 'selected-conversation',
    tools: selectedConversationTools,
  },
  'live-audio-only': { mode: 'live-audio-only', tools: noTools },
  'unsupported-model': { mode: 'unsupported-model', tools: noTools },
} as const;

/** Resolve the active app path, not the transport exports that happen to exist. */
export function voiceConversationCapability(
  selection: Pick<VoiceSettings, 'mode' | 'model'>,
) {
  if (selection.mode === 'local') return capabilities['selected-conversation'];
  return selection.model === liveModel
    ? capabilities['live-audio-only']
    : capabilities['unsupported-model'];
}
