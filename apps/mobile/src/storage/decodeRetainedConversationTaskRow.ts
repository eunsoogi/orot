import {
  parseTask,
  voiceEndTaskIdentityMatches,
} from './conversationTaskCardCodec';
import { observedVoiceMarkerAvailability } from './conversationVoiceObservedCaptionStorage';
import type { SqlValue } from '@orot/storage';

export function decodeRetainedConversationTaskRow(
  row: Readonly<Record<string, SqlValue>>,
) {
  const task =
    typeof row.task_json === 'string' && row.task_json.length <= 4096
      ? parseTask(JSON.parse(row.task_json))
      : null;
  if (
    !task ||
    typeof row.id !== 'string' ||
    !row.id ||
    row.id.length > 200 ||
    !voiceEndTaskIdentityMatches(row.id, task) ||
    (task.kind === 'voice_end' && row.revision !== 1) ||
    typeof row.created_at !== 'string' ||
    !Number.isFinite(Date.parse(row.created_at)) ||
    new Date(row.created_at).toISOString() !== row.created_at ||
    typeof row.revision !== 'number' ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  )
    throw new Error('Invalid retained task card.');
  return {
    id: row.id,
    createdAt: row.created_at,
    revision: row.revision,
    task,
    ...observedVoiceMarkerAvailability(task.kind, row.has_captions),
  };
}
