import { NativeModules } from 'react-native';
import type { ReplyIdentity } from './replyNotificationCoordinator';

export type ReplyNotificationPreference = {
  enabled: boolean;
  preview: boolean;
};

export interface ReplyNotificationNative {
  read(): Promise<ReplyNotificationPreference>;
  save(
    preference: ReplyNotificationPreference,
  ): Promise<'authorized' | 'denied' | 'disabled' | 'error'>;
  authorized(): Promise<boolean>;
  submit(value: ReplyIdentity & { preview: string }): Promise<boolean>;
  removeSession(sessionId: string): Promise<void>;
  removeAll(): Promise<void>;
  consumeTarget(): Promise<unknown>;
  acknowledgeTarget(requestId: string): Promise<void>;
}

/** Permission is requested only by the explicit settings save, never by completion handling. */
export function nativeReplyNotifications(): ReplyNotificationNative {
  const module = NativeModules.ReplyNotificationModule as
    ReplyNotificationNative | undefined;
  if (!module) throw new Error('Reply notifications are unavailable.');
  return module;
}
