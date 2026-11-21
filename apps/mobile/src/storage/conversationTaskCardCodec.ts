import { DailyReportIdentitySchema } from '@orot/domain';
import type { DailyReportIdentity } from '@orot/domain';
import { validConversationReportTarget } from './conversationReportTarget';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';

/** Only stable identifiers are retained; form inputs, prompts and model output stay in their owners. */
export type VoiceEndTaskCard = {
  readonly kind: 'voice_end';
  readonly durationSeconds: number;
};

export type ConversationTaskCard =
  | VoiceEndTaskCard
  | {
      readonly kind: 'daily_report';
      readonly identity: DailyReportIdentity;
      /** A delivered reminder keeps its historical lookup rather than implying a new request. */
      readonly reminder?: true;
      readonly report?: NonNullable<ConversationEntryContext['dailyReport']>;
    }
  | {
      readonly kind: 'treatment';
      readonly artifactId: string;
      readonly artifactRevision?: string;
    };

export function parseTask(value: unknown): ConversationTaskCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.kind === 'voice_end')
    return Object.keys(v).sort().join(',') === 'durationSeconds,kind' &&
      typeof v.durationSeconds === 'number' &&
      Number.isSafeInteger(v.durationSeconds) &&
      v.durationSeconds >= 0
      ? { kind: 'voice_end', durationSeconds: v.durationSeconds }
      : null;
  if (v.kind === 'treatment')
    return ['artifactId,kind', 'artifactId,artifactRevision,kind'].includes(
      Object.keys(v).sort().join(','),
    ) &&
      typeof v.artifactId === 'string' &&
      v.artifactId.length > 0 &&
      v.artifactId.length <= 200 &&
      (v.artifactRevision === undefined ||
        (typeof v.artifactRevision === 'string' &&
          /^[0-9a-f]{1,16}$/u.test(v.artifactRevision)))
      ? (v as unknown as ConversationTaskCard)
      : null;
  if (
    v.kind !== 'daily_report' ||
    ![
      'identity,kind',
      'identity,kind,report',
      'identity,kind,reminder',
      'identity,kind,reminder,report',
    ].includes(Object.keys(v).sort().join(','))
  )
    return null;
  const identity = DailyReportIdentitySchema.safeParse(v.identity);
  if (
    !identity.success ||
    ('reminder' in v && v.reminder !== true) ||
    (v.report !== undefined &&
      (!validConversationReportTarget(v.report) ||
        (v.report as NonNullable<ConversationEntryContext['dailyReport']>)
          .identity.key !== identity.data.key))
  )
    return null;
  return v as unknown as ConversationTaskCard;
}

export function voiceEndTaskIdentityMatches(
  id: string,
  task: ConversationTaskCard,
) {
  if (task.kind === 'voice_end')
    return /^voice-end:[a-z0-9-]{1,128}$/u.test(id);
  return !id.startsWith('voice-end:');
}
