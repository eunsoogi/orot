const nativeTextEncoder = globalThis.TextEncoder;
const nativeTextDecoder = globalThis.TextDecoder;

jest.mock('web-streams-polyfill/polyfill', () => ({}));
jest.mock('react-native-get-random-values', () => ({}));

describe('agent polyfills', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'TextEncoder', {
      configurable: true,
      writable: true,
      value: nativeTextEncoder,
    });
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      writable: true,
      value: nativeTextDecoder,
    });
  });

  it('preserves existing TextEncoder and TextDecoder globals', () => {
    jest.isolateModules(() => {
      require('../polyfills');
    });

    expect(globalThis.TextEncoder).toBe(nativeTextEncoder);
    expect(globalThis.TextDecoder).toBe(nativeTextDecoder);
  });

  it('installs a missing TextDecoder that restores Korean and Unicode UTF-8', () => {
    Object.defineProperty(globalThis, 'TextDecoder', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    jest.isolateModules(() => {
      require('../polyfills');
    });

    expect(globalThis.TextEncoder).toBe(nativeTextEncoder);
    expect(globalThis.TextDecoder).toEqual(expect.any(Function));
    const text = '환자 기록: café 🌱🩺';
    expect(new globalThis.TextDecoder().decode(new globalThis.TextEncoder().encode(text))).toBe(text);
  });
});
