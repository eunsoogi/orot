/* eslint no-bitwise: off */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CHUNK_LENGTH = 8_192;

// React Native's bridge takes a string payload, so encode bytes locally without adding a codec dependency.
export function encodeAudioBase64(bytes: Uint8Array): string {
  let result = '';
  let chunk = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;

    chunk += ALPHABET[first >> 2];
    chunk += ALPHABET[((first & 0x03) << 4) | (second >> 4)];
    chunk += hasSecond ? ALPHABET[((second & 0x0f) << 2) | (third >> 6)] : '=';
    chunk += hasThird ? ALPHABET[third & 0x3f] : '=';

    if (chunk.length >= CHUNK_LENGTH) {
      result += chunk;
      chunk = '';
    }
  }

  return result + chunk;
}

export function decodeAudioBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error('Synthetic transcription audio is not valid Base64.');
  }

  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let outputIndex = 0;
  for (let index = 0; index < value.length; index += 4) {
    const first = ALPHABET.indexOf(value[index]);
    const second = ALPHABET.indexOf(value[index + 1]);
    const third = value[index + 2] === '=' ? 0 : ALPHABET.indexOf(value[index + 2]);
    const fourth = value[index + 3] === '=' ? 0 : ALPHABET.indexOf(value[index + 3]);
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (outputIndex < output.length) output[outputIndex++] = (combined >> 16) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = (combined >> 8) & 0xff;
    if (outputIndex < output.length) output[outputIndex++] = combined & 0xff;
  }
  return output;
}
