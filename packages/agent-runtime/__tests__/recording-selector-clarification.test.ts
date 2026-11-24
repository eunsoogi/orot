import { AIMessage } from '@langchain/core/messages';
import { createLangChainEvidenceTool } from '../src/langchain/evidenceTool';
import { createSearchNodes } from '../src/multiAgent/searchNodes';
import type { EvidenceSearchTool } from '../src/multiAgent/evidenceContracts';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import type { WorkflowState } from '../src/multiAgent/state';

const recordingTool = 'local-saved-recording-transcript';
const outcome = { status: 'recording_selector_required' } as const;
const request = {
  operationRunId: 'synthetic',
  operationKey: 'tool-1',
  allowedScope: { sourceKinds: ['personal_record'] as const },
  resultLimit: 1,
  maxPayloadBytes: 65536,
};

function tool(id: string, result: object): EvidenceSearchTool {
  return {
    id,
    description: 'Synthetic local recording search.',
    execution: 'local_read_only',
    sourceKind: 'personal_record',
    inputSchema: { type: 'object' },
    parseInput: () => ({}),
    search: async () => result as typeof outcome,
  };
}

it.each([
  [recordingTool, outcome, outcome],
  ['another-records-tool', outcome, { status: 'invalid_output' }],
  [recordingTool, { ...outcome, privateId: 'synthetic' }, { status: 'invalid_output' }],
] as const)(
  'validates the recording-specific metadata-free tool result (%s)',
  async (id, result, expected) => {
    const revalidateEvidence = jest.fn(async () => true);
    const adapter = createLangChainEvidenceTool(tool(id, result), {
      signal: new AbortController().signal,
      timedOut: () => false,
      reserveSearch: () => request,
      revalidateEvidence,
    });
    expect(JSON.parse(await adapter.invoke({}))).toEqual(expected);
    expect(revalidateEvidence).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  'ends the graph before publishing any evidence (pending native call: %s)',
  async (native) => {
    const revalidateEvidence = jest.fn(async () => true);
    const empty = { items: [], coverage: [], conflicts: [] };
    const context = {
      options: {
        tools: [tool(recordingTool, outcome)],
        execution: request,
        task: {},
        revalidateEvidence,
      },
      signal: new AbortController().signal,
      timedOut: () => false,
      researchInput: {},
      currentEvidence: empty,
      ...(native
        ? {
            pendingNativeToolCallId: 'native-call',
            nativeToolMessages: [
              new AIMessage({
                content: '',
                tool_calls: [{ name: recordingTool, args: {}, id: 'native-call' }],
              }),
            ],
          }
        : {}),
    } as unknown as RuntimeContext<unknown>;
    const state = {
      operationRunId: request.operationRunId,
      selectedToolId: recordingTool,
      pendingOperation: { kind: 'tool', operationKey: 'tool-1' },
      evidenceReferences: [],
      toolCalls: 1,
      modelCalls: 1,
      budget: { maxPayloadBytes: 65536, maxEvidenceItems: 1, maxToolCalls: 64, maxModelCalls: 64 },
    } as unknown as WorkflowState;

    expect(
      await createSearchNodes(context).executeSearch(state, {
        writer: () => {},
        interrupt: () => {
          throw new Error('The finished node cannot interrupt.');
        },
        signal: context.signal,
      }),
    ).toMatchObject({
      phase: 'complete',
    });
    expect(context.outcome).toEqual({
      status: 'needs_clarification',
      reason: 'A specific saved recording is required.',
      clarification: 'recording_selector_required',
    });
    expect(context.researchInput).toBeUndefined();
    expect(context.pendingNativeToolCallId).toBeUndefined();
    expect(context.nativeToolMessages).toBeUndefined();
    expect(context.currentEvidence).toBe(empty);
    expect(revalidateEvidence).not.toHaveBeenCalled();
  },
);
