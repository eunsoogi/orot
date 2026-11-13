import { AppState } from 'react-native';
import { replyNotificationInvalidation } from './replyNotificationInvalidation';

/** On foreground entry, remove old previews even if deletion ended before its cleanup completed. */
export function reconcileReplyPrivacy() {
  if (AppState.currentState === 'active')
    replyNotificationInvalidation.invalidate();
  const subscription = AppState.addEventListener('change', state => {
    if (state === 'active') replyNotificationInvalidation.invalidate();
  });
  return () => subscription.remove();
}
