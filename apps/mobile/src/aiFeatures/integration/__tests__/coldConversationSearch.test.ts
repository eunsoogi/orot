import type { JsonValue } from '@orot/model-runtime';
import { coldRagFactoryFixture as fixture } from '../testSupport/coldRagFactoryFixture';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';
import { readColdConversationSearch } from '../coldConversationSearch';
import type { ColdConversationSearch } from '../coldConversationSearch';
import { continuationInput } from '../../../storage/conversationWorkflowContinuationIdentity';

// Completed eager results are history, never permission to repeat a provider request.
test.each<ColdConversationSearch>([
  { version: 1, status: 'success', charged: true },
  { version: 1, status: 'empty', charged: true },
  { version: 1, status: 'consent_required', charged: true },
  { version: 1, status: 'unavailable', charged: true },
  { version: 1, status: 'unavailable', charged: false },
])(
  'restores exact eager budget and tool policy without search ($status/$charged)',
  async search => {
    const f = await fixture(search);
    const restored = await restoreColdRagConversationFactory({
      descriptor: f.descriptor,
      dependencies: f.dependencies,
      signal: f.controller.signal,
      readKnownCallIds: async () => [],
    });
    expect(continuationInput(restored.options)).toBe(f.descriptor.exactInput);
    expect(restored.options.initialSearch).toBeUndefined();
    expect(restored.options.execution.budget).toEqual(
      f.options.execution.budget,
    );
    expect(restored.options.tools.map(t => t.id)).toEqual(
      f.options.tools.map(t => t.id),
    );
    expect(restored.publicSearch).toEqual(search);
    expect((await restored.capture([])).publicSearch).toEqual(search);
    expect(f.search).not.toHaveBeenCalled();
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.dependencies.externalEvidence.search).not.toHaveBeenCalled();
  },
);

test.each<JsonValue>([
  null,
  {},
  { version: 1, status: 'cancelled', charged: true },
  { version: 1, status: 'success', charged: 'yes' },
])('rejects absent or malformed legacy history', publicSearch => {
  expect(() =>
    readColdConversationSearch({
      invocation: { initialSearch: null },
      publicSearch,
    }),
  ).toThrow('contract');
});

test('changed budget history is rejected before dispatch', async () => {
  const f = await fixture({ version: 1, status: 'unavailable', charged: true });
  f.descriptor.reconstruction = {
    ...f.descriptor.reconstruction,
    publicSearch: { version: 1, status: 'unavailable', charged: false },
  };
  await expect(
    restoreColdRagConversationFactory({
      descriptor: f.descriptor,
      dependencies: f.dependencies,
      signal: f.controller.signal,
      readKnownCallIds: async () => [],
    }),
  ).rejects.toThrow('policy');
  expect(f.search).not.toHaveBeenCalled();
  expect(f.authorize).not.toHaveBeenCalled();
});
