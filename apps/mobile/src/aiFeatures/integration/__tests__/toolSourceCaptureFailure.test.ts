import { NativeModules } from 'react-native';
import { captureConversationToolSources } from '../captureConversationToolSources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { RetainedSourceInvalidError } from '../retainedSourceError';

afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});

// These reproduce source rejection categories, not the cause of a device incident.
test.each([
  'personal_record',
  'reviewed_memory',
  'generated_artifact',
] as const)(
  'unchanged source guards still reject a missing %s while emitting only kind/category',
  async kind => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const registry = new LocalEvidenceReferenceRegistry();
    const item = registry.add({
      reference: { ...reference, sourceKind: kind },
      content: 'private synthetic content',
      validate: async () => false,
      readSource: async () => ({ status: 'missing' }),
    });
    await expect(
      captureConversationToolSources(
        {
          version: 1,
          operationRunId: 'private-run',
          callId: 'private-call',
          toolName: 'search',
          order: 1,
          status: 'completed',
          inputSummary: { sourceKind: kind },
          sources: [item],
        },
        registry,
      ),
    ).rejects.toBeInstanceOf(RetainedSourceInvalidError);
    expect(report.mock.calls).toEqual([
      [
        'storage',
        kind === 'personal_record'
          ? 'tool_capture_personal'
          : kind === 'reviewed_memory'
            ? 'tool_capture_memory'
            : 'tool_capture_generated',
        kind === 'generated_artifact'
          ? 'tool_parent_changed'
          : 'tool_cited_changed',
      ],
    ]);
    expect(JSON.stringify(report.mock.calls)).not.toContain('private');
  },
);
