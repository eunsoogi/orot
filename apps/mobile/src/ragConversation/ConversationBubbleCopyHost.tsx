import {
  Animated,
  Platform,
  requireNativeComponent,
  type ViewProps,
} from 'react-native';

export type ConversationBubbleCopy = {
  readonly copyOwner: string;
  readonly copyText?: string;
  readonly copyLabel: string;
};

const name = 'ConversationBubbleCopyView';
export const ConversationBubbleCopyHost =
  Platform.OS === 'ios'
    ? requireNativeComponent<ViewProps & ConversationBubbleCopy>(name)
    : undefined;
export const AnimatedConversationBubbleCopyHost = ConversationBubbleCopyHost
  ? Animated.createAnimatedComponent(ConversationBubbleCopyHost)
  : undefined;

export type ConversationBubbleCopyScope = {
  readonly sessionId: number;
  readonly allowed: boolean;
};
