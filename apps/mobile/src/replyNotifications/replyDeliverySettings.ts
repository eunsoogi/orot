import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { AiFeatureLocalData } from '../aiFeatures/integration/localData';

/** The app entry owner serializes the complete inbox operation with other entry sources. */
export type ReplyEntryExecutor = (work: () => Promise<void>) => Promise<void>;

/** The app entry owner supplies its onboarding or lock gate as that surface becomes available. */
export interface ReplyDeliverySettings {
  readonly retention?: ConversationSessionOptions['retention'];
  readonly loadLocalData?: () => Promise<AiFeatureLocalData>;
  readonly canEnterReply?: () => boolean;
  readonly executeReplyEntry?: ReplyEntryExecutor;
}
