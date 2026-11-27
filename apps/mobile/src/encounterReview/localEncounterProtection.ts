import { NativeModules } from 'react-native';
import type { ConversationExecutionAdapter } from '../ragConversation/conversationExecutionLease';

const nativeGeneration = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

/** Keep one native protection generation through the selected local review.
 * The stock watcher still retires on delivered lock or route events; a new
 * positive generation must never revive an operation that missed that event. */
export function bindLocalEncounterProtection(
  bridge: ConversationExecutionAdapter | null,
): ConversationExecutionAdapter | null {
  const owner = NativeModules.ConversationExecutionModule as
    { encounterProtectedDataGeneration?: () => Promise<unknown> } | undefined;
  if (
    bridge?.bridgeAvailable !== true ||
    typeof owner?.encounterProtectedDataGeneration !== 'function'
  )
    return null;
  const read = owner.encounterProtectedDataGeneration.bind(owner);
  let generation: string | undefined;
  let retired = false;
  return {
    ...bridge,
    async protectedDataAvailable() {
      if (retired) return false;
      try {
        const sample = await read();
        if (
          NativeModules.ConversationExecutionModule === owner &&
          typeof sample === 'string' &&
          nativeGeneration.test(sample) &&
          (generation === undefined || generation === sample) &&
          !retired
        ) {
          generation = sample;
          return true;
        }
      } catch {
        // The missing or failed native witness cannot become a positive Boolean.
      }
      retired = true;
      return false;
    },
  };
}
