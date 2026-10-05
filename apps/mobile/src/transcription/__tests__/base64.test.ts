import { decodeAudioBase64, encodeAudioBase64 } from '../base64';

describe('encodeAudioBase64', () => {
  it.each([
    [[], ''],
    [[77], 'TQ=='],
    [[77, 97], 'TWE='],
    [[77, 97, 110], 'TWFu'],
    [[0, 255, 16, 2], 'AP8QAg=='],
  ])('encodes %j', (bytes, expected) => {
    expect(encodeAudioBase64(Uint8Array.from(bytes))).toBe(expected);
  });

  it('encodes only the visible portion of a typed-array view', () => {
    const backing = Uint8Array.from([0, 77, 97, 110, 0]);
    expect(encodeAudioBase64(backing.subarray(1, 4))).toBe('TWFu');
  });

  it('decodes the same bytes for a bundled synthetic audio fixture', () => {
    const bytes = Uint8Array.from([0, 12, 255, 56, 91]);
    expect(decodeAudioBase64(encodeAudioBase64(bytes))).toEqual(bytes);
  });

  it('rejects malformed Base64 instead of passing an empty fixture to Apple speech', () => {
    expect(() => decodeAudioBase64('not base64')).toThrow('not valid Base64');
  });
});
