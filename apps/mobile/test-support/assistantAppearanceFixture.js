/* global jest */
// Existing app tests start from an explicitly configured identity; gate tests override it.
jest.mock('../src/assistantAppearance/appearanceStore', () => ({
  appearanceStore: {
    load: jest.fn(async () => ({ avatar: 'neutral', name: null })),
    save: jest.fn(async value => value),
    clear: jest.fn(async () => {}),
  },
}));

// Most app suites start after the visual startup minimum. Its dedicated test
// unmocks the hook and drives the real 2-second timer deterministically.
jest.mock('../src/appEntry/useStartupMinimumDisplay', () => ({
  useStartupMinimumDisplay: () => false,
}));
