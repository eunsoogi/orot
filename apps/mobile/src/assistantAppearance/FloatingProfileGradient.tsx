import { ConversationEdgeGradient } from '../layout/ConversationEdgeGradient';

/** Keep the identity wrapper stable for compact and wide conversation layouts. */
export function FloatingProfileGradient() {
  return (
    <ConversationEdgeGradient edge="top" testID="assistant-floating-gradient" />
  );
}
