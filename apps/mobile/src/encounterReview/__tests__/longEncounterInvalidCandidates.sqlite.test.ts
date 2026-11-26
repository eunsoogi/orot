import { consent } from '../__fixtures__/sqliteReview';
import { fixture, harness } from '../__fixtures__/longReviewHarness';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each([
  ['wrong-quote', 'invalid-candidates'],
  ['locked', 'unavailable'],
] as const)(
  'rejects every candidate when the final page has a bad quote (%s)',
  async (mode, status) => {
    const f = await harness(33, 'local', mode);
    try {
      await f.controller.start(consent);
      expect(f.calls()).toBe(5);
      expect(f.controller.state.status).toBe(status);
      expect(f.controller.state.pending).toBeUndefined();
      expect(f.controller.state.candidates).toEqual([]);
      await f.controller.decide('approve');
      expect(await fixture.rows()).toEqual([]);
    } finally {
      f.controller.dispose();
    }
  },
);
