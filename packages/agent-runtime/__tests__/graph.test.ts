import { createStatefulTwoNodeGraph } from '../src';

describe('stateful LangGraph', () => {
  it('invokes both nodes once and exposes each completed state on the value stream', async () => {
    const graph = createStatefulTwoNodeGraph();
    const input = { value: 3 };
    const expectedNodes = ['increment', 'double'];

    await expect(graph.invoke(input)).resolves.toMatchObject({
      value: 8,
      nodeRuns: expectedNodes,
    });

    const states = [];
    for await (const state of await graph.stream(input, { streamMode: 'values' })) {
      states.push(state);
    }

    expect(states).toHaveLength(3);
    expect(states[0]).toMatchObject({ value: 3, nodeRuns: [] });
    expect(states[1]).toMatchObject({ value: 4, nodeRuns: ['increment'] });
    expect(states[2]).toMatchObject({ value: 8, nodeRuns: expectedNodes });
  });
});
