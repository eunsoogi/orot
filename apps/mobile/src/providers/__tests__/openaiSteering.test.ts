import { chatGPTPlanNativeBridge } from '../openai';

let mockListener: (event: unknown) => void;
const mockStart = jest.fn();
const mockSteer = jest.fn(async (..._args: unknown[]) => {});
const mockCancel = jest.fn();
jest.mock('react-native', () => ({
  NativeModules: {
    OpenAIProviderModule: {
      startSteerableResponse: (...args: unknown[]) => mockStart(...args),
      steerResponse: (...args: unknown[]) => mockSteer(...args),
      cancelResponse: (id: string) => mockCancel(id),
    },
  },
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: (_event: string, listener: (value: unknown) => void) => {
      mockListener = listener;
      return { remove: jest.fn() };
    },
  })),
}));
jest.mock('@orot/provider-openai', () => ({
  createChatGPTPlanProvider: jest.fn(),
  listChatGPTPlanModels: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

test('forwards only the explicit optional bridge transport and submission identity', async () => {
  const request = {
    model: 'synthetic',
    messages: [{ role: 'user' as const, content: 'Synthetic' }],
  };
  await chatGPTPlanNativeBridge.startSteerableResponse!(
    'request',
    'account',
    request,
  );
  expect(mockStart).toHaveBeenCalledWith(request, 'request', 'account');
  await chatGPTPlanNativeBridge.steerResponse!(
    'request',
    'submission',
    'New constraint',
  );
  expect(mockSteer).toHaveBeenCalledWith(
    'request',
    'submission',
    'New constraint',
  );
});

test.each([
  { type: 'steering_ready' },
  { type: 'response_started', responseId: 'response-synthetic' },
  { type: 'steering', submissionId: 's1', status: 'accepted' },
  {
    type: 'steering',
    submissionId: 's1',
    status: 'pending',
    steerId: 'server-id',
  },
  { type: 'steering', submissionId: 's1', status: 'applied' },
  { type: 'steering', submissionId: 's1', status: 'failed' },
  { type: 'text_snapshot', text: '' },
])(
  'validates the native event without conflating acceptance and application: %p',
  packet => {
    const listener = jest.fn();
    const unsubscribe = chatGPTPlanNativeBridge.subscribe(listener);
    mockListener({ requestId: 'request', packet });
    expect(listener).toHaveBeenCalledWith({ requestId: 'request', ...packet });
    expect(mockCancel).not.toHaveBeenCalled();
    unsubscribe();
  },
);

test.each([
  { type: 'steering', submissionId: '', status: 'accepted' },
  { type: 'steering', submissionId: 's1', status: 'complete' },
  { type: 'steering', submissionId: 's1', status: 'applied', steerId: 7 },
  { type: 'text_snapshot', text: null },
  { type: 'response_started' },
  { type: 'response_started', responseId: '' },
  { type: 'response_started', responseId: 7 },
  { type: 'response_started', responseId: 'x'.repeat(201) },
])(
  'rejects malformed acknowledgement before it reaches durable state: %p',
  packet => {
    const listener = jest.fn();
    const unsubscribe = chatGPTPlanNativeBridge.subscribe(listener);
    mockListener({ requestId: 'request', packet });
    expect(listener).toHaveBeenCalledWith({
      requestId: 'request',
      type: 'failed',
      error: { kind: 'malformed_response' },
    });
    expect(mockCancel).toHaveBeenCalledWith('request');
    unsubscribe();
  },
);
