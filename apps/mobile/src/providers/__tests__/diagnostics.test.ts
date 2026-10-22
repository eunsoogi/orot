import { NativeModules } from 'react-native';
import { reportWorkflowOutcome } from '../diagnostics';

jest.mock('react-native', () => ({
  NativeModules: { OrotProviderDiagnostics: { report: jest.fn() } },
}));

beforeEach(() => jest.clearAllMocks());

test('identifies a skipped required source without exposing source or query content', () => {
  reportWorkflowOutcome(
    'disease',
    'invalid_output',
    undefined,
    'The task requires a source-kind lookup before its final answer.',
  );
  expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenCalledWith(
    'disease',
    'validation',
    'task_required_source',
  );
});

test.each(['json', 'object', 'type', 'citations', 'value', 'fields', 'need'])(
  'reports the closed envelope category %s without content',
  code => {
    reportWorkflowOutcome(
      'disease',
      'invalid_output',
      undefined,
      `The task responder returned an invalid envelope: ${code}.`,
    );
    expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenCalledWith(
      'disease',
      'validation',
      `task_envelope_${code}`,
    );
  },
);

test('reports only a fixed validation category and never a raw validation reason', () => {
  reportWorkflowOutcome(
    'rag',
    'invalid_output',
    undefined,
    'The result cited evidence outside the current validated evidence set.',
  );
  expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenCalledWith(
    'rag',
    'validation',
    'task_citations',
  );
  jest.clearAllMocks();
  reportWorkflowOutcome(
    'rag',
    'invalid_output',
    undefined,
    'synthetic private content',
  );
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['rag', 'validation', 'other'],
    ['rag', 'workflow', 'invalid_output'],
  ]);
});

test.each(['unavailable', 'budget_exceeded', 'stale_evidence'])(
  'keeps the actual workflow failure category %s',
  status => {
    reportWorkflowOutcome('disease', status);
    expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenCalledWith(
      'disease',
      'workflow',
      status,
    );
  },
);

test('reports a closed provider error code without forwarding unknown strings', () => {
  reportWorkflowOutcome('rag', 'unavailable', 'unsupported_input');
  expect(NativeModules.OrotProviderDiagnostics.report).toHaveBeenCalledWith(
    'rag',
    'provider_error',
    'unsupported_input',
  );
  jest.clearAllMocks();
  reportWorkflowOutcome(
    'rag',
    'synthetic private status',
    'synthetic private error',
  );
  expect(NativeModules.OrotProviderDiagnostics.report.mock.calls).toEqual([
    ['rag', 'workflow', 'other'],
  ]);
});
