import {
  nativeToolParameterSchema,
  type EvidenceSearchRequest,
} from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { createResearchInputTracker } from '../../aiFeatures/integration/researchInputTracker';
import { createConversationToolBundle } from '../conversationToolBundle';
import { prepareOwnedConversationReadSelection } from '../ownedConversationReadSelection';

/** Exercise the real catalog schema and parser without granting any live data. */
function fixture() {
  const { data } = localData([]);
  const registry = new LocalEvidenceReferenceRegistry();
  const { tools } = createConversationToolBundle({
    data: { ...data, readHealthContext: jest.fn() },
    registry,
    researchInputs: createResearchInputTracker(registry),
    publicSearchSucceeded: false,
  });
  const tool = tools.find(value => value.id === 'local-health-context')!;
  const allowedScope = { sourceKinds: ['personal_record'] } as const;
  const args = { topics: ['measurements'], days: 7 };
  const signal = new AbortController().signal;
  const request: EvidenceSearchRequest = {
    operationRunId: 'synthetic-owner',
    operationKey: 'tool-2',
    input: tool.parseInput(args)!,
    allowedScope,
    maxPayloadBytes: 4096,
    resultLimit: 3,
    signal,
  };
  let current = true;
  const protectedDataAvailable = jest.fn(async () => true);
  return {
    tool,
    request,
    protectedDataAvailable,
    revoke: () => {
      current = false;
    },
    owner: {
      declaration: {
        name: tool.id,
        parameters: nativeToolParameterSchema(tool.inputSchema),
      },
      operationRunId: request.operationRunId,
      admittedArguments: JSON.stringify(args),
      allowedScope,
      current: () => current,
      protectedDataAvailable,
    },
  };
}

test('binds only the stock schema and exact admitted operation and runtime input', async () => {
  const f = fixture();
  const selection = prepareOwnedConversationReadSelection(f.owner)!;
  expect(selection.permits(f.tool)).toBe(true);
  expect(selection.permits({ ...f.tool, sourceKind: 'reviewed_memory' })).toBe(
    false,
  );
  expect(selection.permits({ ...f.tool, inputSchema: {} })).toBe(false);
  for (const request of [
    { ...f.request, input: { ...f.request.input, days: 31 } },
    { ...f.request, operationRunId: 'replacement-owner' },
    {
      ...f.request,
      allowedScope: { ...f.owner.allowedScope, sourceIds: ['other'] },
    },
  ]) {
    await expect(
      selection.beforeRead(request.signal, request, f.tool),
    ).resolves.toBe(false);
  }
  expect(f.protectedDataAvailable).not.toHaveBeenCalled();
  const permit = await selection.beforeRead(
    f.request.signal,
    f.request,
    f.tool,
  );
  expect(permit && permit.current()).toBe(true);
  f.revoke();
  expect(permit && permit.current()).toBe(false);
});

test('revocation during awaited native protection never returns a read witness', async () => {
  const f = fixture();
  f.protectedDataAvailable.mockImplementationOnce(async () => {
    await Promise.resolve();
    f.revoke();
    return true;
  });
  const selection = prepareOwnedConversationReadSelection(f.owner)!;
  await expect(
    selection.beforeRead(f.request.signal, f.request, f.tool),
  ).resolves.toBe(false);
  expect(f.protectedDataAvailable).toHaveBeenCalledTimes(1);
});
