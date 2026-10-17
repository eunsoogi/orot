import { NativeModules } from 'react-native';
import type { LanguageModelRequest } from '@orot/model-runtime';
import { appleFoundationModelsNativeBridge } from '../src/providers/apple/nativeBridge';
import {
  appleFoundationModelsProbeBridge,
  withMockAppleModel,
} from '../e2e/appleModelMockBridge';

jest.mock('../src/providers/apple/nativeBridge', () => ({
  appleFoundationModelsNativeBridge: { generate: jest.fn() },
}));
jest.mock('../src/providers/apple/serializeRequest', () => ({
  serializeAppleRequest: jest.fn(() => ({
    prompt: 'private synthetic prompt',
    mode: 'test',
  })),
}));

const request: LanguageModelRequest = {
  messages: [{ role: 'user', content: 'private synthetic prompt' }],
};
const script = () => ({ text: 'private synthetic reply' });
let requests: unknown[];
let replies: unknown[];
const configure = jest.fn(async () => {
  requests = [];
  replies = [];
});
const control = {
  configure,
  enqueue: jest.fn(async (value: unknown) => {
    replies.push(value);
  }),
  observation: jest.fn(async () => ({
    requests: [...requests],
    remainingReplies: replies.length,
  })),
};
const generate = appleFoundationModelsNativeBridge.generate as jest.Mock;

// This fixture controls the native accounting boundary; it does not reproduce the hosted RAG cause.
beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.OrotAppleModelMock = control;
  generate.mockImplementation(async () => {
    requests.push({ prompt: 'private synthetic prompt' });
    replies.shift();
    return 'private synthetic reply';
  });
});

async function failure(
  run: () => Promise<unknown>,
  steps = [script, script, script],
) {
  try {
    await withMockAppleModel(steps, run);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(
      'The model mock script was not consumed exactly once',
    );
    expect(message).toContain('diagnostics=');
    return {
      message,
      diagnostics: JSON.parse(message.split('diagnostics=')[1]),
    };
  }
  throw new Error('The incomplete native inventory must remain a failure');
}

test('preserves early workflow outcome and exact counts before native cleanup resets them', async () => {
  const result = {
    availability: 'available',
    terminal: 'unavailable',
    retrieval: 'observed',
    outcome: { status: 'unavailable' },
    requests: ['private synthetic URL'],
    responses: [{ status: 503 }],
    publications: [],
    diagnostics: [{ status: 'response' }],
    parentAborted: false,
  };
  const { diagnostics } = await failure(async () => {
    await appleFoundationModelsProbeBridge.generate(
      request,
      'synthetic-request',
    );
    return result;
  });
  expect(diagnostics).toMatchObject({
    expected: 3,
    dispatched: 1,
    nativeRequests: 1,
    remainingReplies: 0,
    probe: {
      availability: 'available',
      terminal: 'unavailable',
      outcome: 'unavailable',
      retrieval: 'observed',
      requests: 1,
      httpStatuses: [503],
      publications: 0,
      generationStatuses: ['response'],
      parentAborted: false,
    },
  });
  expect(configure).toHaveBeenLastCalledWith({ status: 'unsupportedDevice' });
  expect(requests).toEqual([]);
});

test('reports unconsumed native replies without weakening the exactly-once failure', async () => {
  generate.mockResolvedValueOnce(
    'synthetic response without native consumption',
  );
  const { diagnostics } = await failure(async () => {
    await appleFoundationModelsProbeBridge.generate(
      request,
      'synthetic-request',
    );
    return { terminal: 'unavailable' };
  }, [script]);
  expect(diagnostics).toMatchObject({
    expected: 1,
    dispatched: 1,
    nativeRequests: 0,
    remainingReplies: 1,
  });
  expect(replies).toEqual([]);
});

test('diagnostics omit payloads, URLs, arbitrary errors and injected status strings', async () => {
  const privateValue = 'SENSITIVE_PAYLOAD_TOKEN_HEALTH_QUERY';
  const { message, diagnostics } = await failure(async () => ({
    terminal: privateValue,
    availability: privateValue,
    retrieval: privateValue,
    outcome: {
      status: privateValue,
      answer: privateValue,
      citations: [privateValue],
    },
    requests: [privateValue],
    publications: [{ title: privateValue }],
    failure: privateValue,
    responses: [
      { status: 503, headers: { Authorization: privateValue } },
      { status: privateValue },
      { status: 999 },
    ],
    diagnostics: [
      { status: 'thrown', error: privateValue },
      { status: privateValue },
    ],
  }));
  expect(message).not.toContain(privateValue);
  expect(message).not.toContain('private synthetic');
  expect(diagnostics.probe).toMatchObject({
    terminal: 'unknown',
    availability: 'unknown',
    retrieval: 'unknown',
    outcome: 'unknown',
    httpStatuses: [503],
    generationStatuses: ['thrown', 'unknown'],
    requests: 1,
    publications: 1,
  });
});

test('complete native consumption still returns original result and observation', async () => {
  const value = { terminal: 'answer', result: 'unchanged' };
  const result = await withMockAppleModel([script], async () => {
    await appleFoundationModelsProbeBridge.generate(
      request,
      'synthetic-request',
    );
    return value;
  });
  expect(result).toMatchObject({
    ...value,
    modelExecution: 'mock',
    actualModel: 'not-run',
    mockObservation: {
      requests: [{ prompt: 'private synthetic prompt' }],
      remainingReplies: 0,
    },
  });
  expect(configure).toHaveBeenLastCalledWith({ status: 'unsupportedDevice' });
});

test('a thrown operation keeps its original failure and still resets mock ownership', async () => {
  const primary = new Error('synthetic original operation failure');
  await expect(
    withMockAppleModel([script], async () => {
      throw primary;
    }),
  ).rejects.toBe(primary);
  expect(configure).toHaveBeenLastCalledWith({ status: 'unsupportedDevice' });
});
