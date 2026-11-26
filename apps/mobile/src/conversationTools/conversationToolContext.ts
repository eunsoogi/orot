import type { MultiAgentInvocation } from '@orot/agent-runtime';
import type { ConversationHeartRateRequest } from '../aiFeatures/integration/conversationHeartRateRequest';
import type { TypedHeartRateRecipient } from '../aiFeatures/integration/conversationHeartRateModelOwner';
import type { ResearchSessionLease } from '../storage/researchArtifactStorage';

/** Capabilities and negative fences supplied by the owning request adapter.
 * The catalog never imports a channel's UI observer or uses model text as an
 * identity or to supply any of these fields. */
export type ConversationToolContext = Pick<
  MultiAgentInvocation,
  'onApprovalWait'
> & {
  readonly inputOrigin?: 'composer' | 'shortcut';
  readonly protectedLocalInput?: true;
  readonly conversationScope?: string;
  readonly retentionSession?: ResearchSessionLease;
  readonly recordingClarification?: unknown;
  readonly photoInput?: unknown;
  readonly expectedVoiceSelection?: unknown;
  readonly expectedConversationModel?: {
    readonly isCurrent?: () => boolean;
    readonly isDurablyCurrent?: () => Promise<boolean>;
  };
  readonly confirmTypedHeartRate?: (
    scope: ConversationHeartRateRequest,
    recipient: TypedHeartRateRecipient,
    signal: AbortSignal,
  ) => Promise<boolean>;
};

/** Positive current platform protection at the moment of each owned tool use. */
export type ProtectedConversationToolRead = () => Promise<boolean>;
