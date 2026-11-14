import { END, START, StateGraph } from '@langchain/langgraph/web';
import type { MultiAgentWorkflowOptions } from './contracts';
import type { RuntimeContext } from './runtimeContext';
import { createNodes } from './nodes';
import { pauseBoundaryWrapper } from './workflowPause';
import { MultiAgentState, routeForPhase, workflowNodeRoutes, type WorkflowState } from './state';

export function makeGraph<TResult>(
  context: RuntimeContext<TResult>,
  graphOptions: Pick<MultiAgentWorkflowOptions<TResult>, 'checkpointer' | 'store'> = {},
) {
  const nodes = createNodes(context);
  const wrap = pauseBoundaryWrapper(context);
  const route = (state: WorkflowState) => routeForPhase(state.phase);
  // Persist initial channels before a requested drain; no provider/tool runs in this node.
  return new StateGraph(MultiAgentState)
    .addNode(
      'checkpointStart',
      wrap(() => ({})),
    )
    .addNode(
      'prepareResponder',
      wrap((state) => nodes.prepareResponder(state)),
    )
    .addNode('invokeResponder', wrap(nodes.invokeResponder))
    .addNode('prepareResearcher', wrap(nodes.prepareResearcher))
    .addNode('invokeResearcher', wrap(nodes.invokeResearcher))
    .addNode('prepareSearch', wrap(nodes.prepareSearch))
    .addNode('executeSearch', wrap(nodes.executeSearch))
    .addNode(
      'prepareRevision',
      wrap((state) => nodes.prepareRevision(state)),
    )
    .addNode('invokeRevision', wrap(nodes.invokeRevision))
    .addEdge(START, 'checkpointStart')
    .addConditionalEdges('checkpointStart', route, workflowNodeRoutes)
    .addConditionalEdges('prepareResponder', (state) => (state.terminal ? END : 'invokeResponder'))
    .addConditionalEdges(
      'invokeResponder',
      (s) => (s.awaitingAuthorization ? 'invokeResponder' : route(s)),
      { ...workflowNodeRoutes, invokeResponder: 'invokeResponder' },
    )
    .addConditionalEdges('prepareResearcher', (state) =>
      state.terminal ? END : 'invokeResearcher',
    )
    .addConditionalEdges(
      'invokeResearcher',
      (s) => (s.awaitingAuthorization ? 'invokeResearcher' : route(s)),
      { ...workflowNodeRoutes, invokeResearcher: 'invokeResearcher' },
    )
    .addConditionalEdges('prepareSearch', (state) => (state.terminal ? END : 'executeSearch'))
    .addConditionalEdges(
      'executeSearch',
      (s) => (s.awaitingAuthorization ? 'executeSearch' : route(s)),
      { ...workflowNodeRoutes, executeSearch: 'executeSearch' },
    )
    .addConditionalEdges('prepareRevision', (state) => (state.terminal ? END : 'invokeRevision'))
    .addConditionalEdges(
      'invokeRevision',
      (s) => (s.awaitingAuthorization ? 'invokeRevision' : route(s)),
      { ...workflowNodeRoutes, invokeRevision: 'invokeRevision' },
    )
    .compile({ store: graphOptions.store, checkpointer: graphOptions.checkpointer });
}
