// Existing app tests start from an explicitly configured identity; gate tests override it.
jest.mock('../src/assistantAppearance/appearanceStore', () => ({
  appearanceStore: {
    load: jest.fn(async () => ({ avatar: 'neutral', name: null })),
    save: jest.fn(async value => value),
    clear: jest.fn(async () => {}),
  },
}));
