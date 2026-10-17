import { createStatefulTwoNodeGraph } from '@orot/agent-runtime';
import type { AgentGraphState } from '@orot/agent-runtime';

// Preserve every Hermes invoke/stream assertion without depending on a rendered probe screen.
const RUNS = 20;
const expectedNodeRuns = ['increment', 'double'];

function assertState(
  label: string,
  state: AgentGraphState,
  expectedValue: number,
  nodeRuns: string[],
) {
  if (
    state.value !== expectedValue ||
    state.nodeRuns.join(',') !== nodeRuns.join(',')
  ) {
    throw new Error(
      label +
        ' returned value=' +
        state.value +
        ', nodes=' +
        state.nodeRuns.join(','),
    );
  }
}

export async function runGraphIntegrationProbe() {
  const graph = createStatefulTwoNodeGraph();
  for (let input = 0; input < RUNS; input += 1) {
    let phase = 'invoke';
    try {
      assertState(
        phase + ' ' + input,
        await graph.invoke({ value: input }),
        (input + 1) * 2,
        expectedNodeRuns,
      );
      const states: AgentGraphState[] = [];
      phase = 'stream';
      for await (const state of await graph.stream(
        { value: input },
        { streamMode: 'values' },
      )) {
        states.push(state);
      }
      if (states.length !== expectedNodeRuns.length + 1) {
        throw new Error(
          'stream ' + input + ' returned ' + states.length + ' states',
        );
      }
      assertState('stream initial ' + input, states[0], input, []);
      assertState('stream increment ' + input, states[1], input + 1, [
        'increment',
      ]);
      assertState(
        'stream double ' + input,
        states[2],
        (input + 1) * 2,
        expectedNodeRuns,
      );
    } catch (error) {
      const detail =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      throw new Error(phase + ' ' + input + ': ' + detail);
    }
  }
  return { invocations: RUNS, streams: RUNS, duplicateNodes: 0 };
}
