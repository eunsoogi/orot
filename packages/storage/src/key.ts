export interface SecureKeyStore {
  getSecret(): Promise<string | null>;
  setSecret(secret: string): Promise<void>;
}

export type RandomByteSource = (target: Uint8Array) => void;

const KEY_BYTES = 32;
const KEY_PATTERN = /^[0-9a-f]{64}$/i;

export async function resolveDatabaseKey(
  keyStore: SecureKeyStore,
  randomBytes: RandomByteSource,
): Promise<string> {
  const stored = await keyStore.getSecret();
  if (stored !== null) {
    if (!KEY_PATTERN.test(stored)) {
      throw new Error('The secure storage key is invalid.');
    }
    return stored;
  }

  const bytes = new Uint8Array(KEY_BYTES);
  randomBytes(bytes);
  const generated = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  bytes.fill(0);
  await keyStore.setSecret(generated);
  if ((await keyStore.getSecret()) !== generated) {
    throw new Error('The secure storage key could not be verified.');
  }
  return generated;
}
