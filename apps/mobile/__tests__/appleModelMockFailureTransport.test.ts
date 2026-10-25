import { NativeModules } from 'react-native';
import { runDomainTestOperation } from '../e2e/domainTestOperations';
import { withMockAppleModel } from '../e2e/appleModelMockBridge';
import { modelMockFailureDiagnostics } from '../e2e/appleModelMockDiagnostics';
import { startTestOperationRunner } from '../e2e/testOperationRunner';

jest.mock('../e2e/domainTestOperations', () => ({
  runDomainTestOperation: jest.fn(),
}));
jest.mock('../src/providers/apple/nativeBridge', () => ({
  appleFoundationModelsNativeBridge: {},
}));

test('the actual command runner forwards safe diagnostic failure text without completing the operation', async () => {
  const complete = jest.fn();
  let stop: () => void;
  let receive: (message: string) => void;
  const failed = new Promise<string>(resolve => {
    receive = resolve;
  });
  NativeModules.OrotAppleModelMock = {
    configure: jest.fn(async () => {}),
    observation: async () => ({ requests: [], remainingReplies: 0 }),
  };
  NativeModules.OrotTestControl = {
    nextRequest: async () => ({
      id: 'synthetic-operation',
      operation: 'rag-workflow',
      parameters: {},
    }),
    complete,
    fail: (id: string, message: string) => {
      expect(id).toBe('synthetic-operation');
      stop();
      receive(message);
    },
  };
  // Controlled early termination observes the real wrapper and broker; no network or native execution is claimed.
  (runDomainTestOperation as jest.Mock).mockImplementationOnce(() =>
    withMockAppleModel([() => ({ text: 'private reply' })], async () => ({
      terminal: 'unavailable',
      outcome: { status: 'unavailable' },
      failure: 'private error',
    })),
  );
  stop = startTestOperationRunner();
  const message = await failed;
  expect(message).toContain('diagnostics=');
  const diagnostics = JSON.parse(message.split('diagnostics=')[1]);
  expect(diagnostics).toMatchObject({
    expected: 1,
    dispatched: 0,
    nativeRequests: 0,
    probe: { terminal: 'unavailable', outcome: 'unavailable' },
  });
  expect(message).not.toContain('private');
  expect(complete).not.toHaveBeenCalled();
});

test('native counters and bounded status lists cannot add arbitrary payloads to the failure', () => {
  const diagnostics = modelMockFailureDiagnostics(
    3,
    2,
    {
      requests: [{ prompt: 'PRIVATE_NATIVE_PAYLOAD' }],
      remainingReplies: 'PRIVATE_NATIVE_PAYLOAD',
    },
    {
      responses: Array.from({ length: 12 }, (_, index) => ({
        status: 200 + index,
      })),
      diagnostics: Array.from({ length: 12 }, () => ({
        status: 'thrown',
        error: 'PRIVATE_NATIVE_PAYLOAD',
      })),
    },
  );
  expect(diagnostics.remainingReplies).toBeNull();
  expect(diagnostics.probe.httpStatuses).toHaveLength(8);
  expect(diagnostics.probe.generationStatuses).toHaveLength(8);
  expect(diagnostics.probe.generationCalls).toBe(12);
  expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE_NATIVE_PAYLOAD');
});
