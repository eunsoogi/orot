import { NativeModules, Platform } from 'react-native';

const verified = new WeakSet<object>();
export interface ConversationProcessIdentity {
  readonly value: string;
}
const valid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

/** Only the app-native, process-scoped UUID can prove a different process owner.
 * Bridge absence, locked data, JS reload and lease expiry do not imply process death.
 * The nonce is private recovery metadata, never a user identifier or telemetry value.
 */
export async function readConversationProcessIdentity(
  signal: AbortSignal,
): Promise<ConversationProcessIdentity | undefined> {
  if (signal.aborted || Platform.OS !== 'ios') return undefined;
  const native = NativeModules.ConversationExecutionModule as
    { processIdentity?: () => Promise<unknown> } | undefined;
  if (typeof native?.processIdentity !== 'function') return undefined;
  try {
    const value = await native.processIdentity();
    if (signal.aborted || !valid(value)) return undefined;
    const identity = Object.freeze({ value: value.toLowerCase() });
    verified.add(identity);
    return identity;
  } catch {
    return undefined;
  }
}

/** This is one necessary condition, not a grant: DB owner, claim, exact checkpoint,
 * receipt, deletion/source epoch and fresh consent must still be checked atomically.
 */
export function isDifferentConversationProcess(
  prior: unknown,
  current: ConversationProcessIdentity,
): boolean {
  return (
    verified.has(current) &&
    valid(prior) &&
    prior.toLowerCase() !== current.value
  );
}
