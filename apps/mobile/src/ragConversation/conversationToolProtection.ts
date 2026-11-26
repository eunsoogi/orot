import { conversationExecutionNative } from './conversationExecutionNative';

/** Text supplies a fresh positive protection probe, never its UI or background lease. */
export async function protectedConversationToolDataAvailable(): Promise<boolean> {
  const native = conversationExecutionNative();
  return (
    native?.bridgeAvailable === true &&
    (await native.protectedDataAvailable()) === true
  );
}
