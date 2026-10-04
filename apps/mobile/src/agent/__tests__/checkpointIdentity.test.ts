import { createWorkflowCheckpointConfig } from '../checkpointIdentity';

describe('workflow checkpoint identity', () => {
  it('encodes workflow and app thread ids while preserving LangGraph namespaces', () => {
    expect(
      createWorkflowCheckpointConfig(
        'visit/questions',
        'thread:42',
        'subgraph:1',
      ),
    ).toEqual({
      configurable: {
        thread_id: 'visit%2Fquestions:thread%3A42',
        checkpoint_ns: 'subgraph:1',
      },
    });
  });

  it('rejects empty workflow or app thread ids', () => {
    expect(() => createWorkflowCheckpointConfig('', 'thread-42')).toThrow(
      'Workflow checkpoint identity requires a workflow and app thread id.',
    );
    expect(() =>
      createWorkflowCheckpointConfig('visit/questions', ' '),
    ).toThrow(
      'Workflow checkpoint identity requires a workflow and app thread id.',
    );
  });
});
