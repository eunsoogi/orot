import { Annotation, END, START, StateGraph } from '@langchain/langgraph/web';
export { createLanguageModelProviderGraph } from './modelProviderGraph';

export type AgentGraphNode = 'increment' | 'double';

export type AgentGraphState = {
  value: number;
  nodeRuns: AgentGraphNode[];
};

const State = Annotation.Root({
  value: Annotation<number>(),
  nodeRuns: Annotation<AgentGraphNode[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
});

export function createStatefulTwoNodeGraph() {
  return new StateGraph(State)
    .addNode('increment', state => ({
      value: state.value + 1,
      nodeRuns: ['increment'],
    }))
    .addNode('double', state => ({
      value: state.value * 2,
      nodeRuns: ['double'],
    }))
    .addEdge(START, 'increment')
    .addEdge('increment', 'double')
    .addEdge('double', END)
    .compile();
}
