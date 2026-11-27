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

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

test('a native lock and unlock missed by JS retires held local page generation', async () => {
  const started = gate();
  const model = gate();
  const f = await harness(9, 'local', undefined, async () => {
    started.release();
    await model.wait;
  });
  const pending = f.controller.start(consent);
  try {
    await started.wait;
    // The availability Boolean and JS subscription never report the lock. Only
    // the app-owned native generation records the protected-data transition.
    f.generation.mockResolvedValue('2686cef9-2adf-48e6-b055-c2a1777ba952');
    model.release();
    await pending;
    expect(f.controller.state.status).toBe('unavailable');
    expect(f.controller.state.pending).toBeUndefined();
    expect(f.controller.state.candidates).toEqual([]);
    expect(f.calls()).toBe(1);
    expect(await fixture.rows()).toEqual([]);
  } finally {
    model.release();
    await pending;
    f.controller.dispose();
  }
});

test('the legacy Boolean cannot authorize the local page route without a native generation', async () => {
  const f = await harness();
  try {
    f.generation.mockResolvedValue(null);
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('unavailable');
    expect(f.calls()).toBe(0);
    expect(await fixture.rows()).toEqual([]);
    f.generation.mockResolvedValue('2686cef9-2adf-48e6-b055-c2a1777ba952');
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    expect(f.calls()).toBe(2);
    expect(await fixture.rows()).toEqual([]);
  } finally {
    f.controller.dispose();
  }
});

test('missed native revocation also prevents saving a previously presented exact review', async () => {
  const f = await harness();
  try {
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    f.generation.mockResolvedValue('2686cef9-2adf-48e6-b055-c2a1777ba952');
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('unavailable');
    expect(f.controller.state.pending).toBeUndefined();
    expect(await fixture.rows()).toEqual([]);
    expect(f.calls()).toBe(2);
  } finally {
    f.controller.dispose();
  }
});
