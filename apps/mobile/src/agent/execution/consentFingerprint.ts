import { NativeModules } from 'react-native';

/** CryptoKit hashes an ephemeral snapshot; neither native logging nor storage receives its plaintext. */
export async function fingerprintConsentSnapshot(
  snapshot: string,
): Promise<string> {
  const bridge = NativeModules.OrotConsentFingerprint as
    { sha256(text: string): Promise<string> } | undefined;
  if (!bridge) throw new Error('Consent fingerprinting is unavailable.');
  return bridge.sha256(snapshot);
}
