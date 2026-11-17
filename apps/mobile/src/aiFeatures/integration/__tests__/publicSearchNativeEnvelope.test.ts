import { createChatGPTPlanProvider } from '@orot/provider-openai';
import { chatGPTPlanNativeBridge } from '../../../providers/openai';
import { createPublicWebEvidence } from '../publicWebEvidence';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

let mockListener: (event: unknown) => void;
const mockStart = jest.fn();
const mockCancel = jest.fn();
const mockRemove = jest.fn();
jest.mock('react-native', () =>
  Object.defineProperties(Object.create(jest.requireActual('react-native')), {
    NativeModules: {
      value: {
        OpenAIProviderModule: {
          startResponse: (...args: unknown[]) => mockStart(...args),
          cancelResponse: (id: string) => mockCancel(id),
        },
      },
    },
    NativeEventEmitter: {
      value: jest.fn().mockImplementation(() => ({
        addListener: (_name: string, listener: (event: unknown) => void) => {
          mockListener = listener;
          return { remove: mockRemove };
        },
      })),
    },
  }),
);

beforeEach(() => jest.clearAllMocks());

// Mock the OS event surface and account/response data, but connect the shipping
// envelope validator, bridge, provider, consent and evidence registration.
test.each([
  'success',
  'refusal',
  'invalid-citation',
  'denied',
  'aborted',
] as const)(
  'preserves native public-search lifecycle through evidence (%s)',
  async mode => {
    mockStart.mockImplementation((_payload: unknown, requestId: string) => {
      const emit = (packet: unknown) => mockListener({ requestId, packet });
      mockListener({
        requestId: 'unrelated',
        packet: { type: 'failed', error: { code: 'safety_refusal' } },
      });
      emit({ type: 'response_started', responseId: 'synthetic-response' });
      if (mode === 'refusal')
        emit({ type: 'failed', error: { code: 'safety_refusal' } });
      emit({ type: 'text_delta', text: publicResponse.text });
      emit({
        type: 'completed',
        ...publicResponse,
        webSearch: {
          callCount: publicResponse.callCount,
          citations:
            mode === 'invalid-citation'
              ? [{ title: 'Invalid', url: 'ftp://example.org/invalid' }]
              : publicResponse.citations,
        },
      });
    });
    const provider = createChatGPTPlanProvider({
      bridge: chatGPTPlanNativeBridge,
      issuedClientID: 'synthetic-account',
      model: { slug: 'synthetic', displayName: 'Synthetic' },
      requestIDFactory: () => 'synthetic-search',
    });
    const run = publicEvidenceFixture();
    run.search.mockImplementation((request, options) =>
      provider.searchPublicWeb!(request, options),
    );
    if (mode === 'denied') run.authorize.mockResolvedValue('renewal_required');
    if (mode === 'aborted') run.controller.abort();
    const evidence = createPublicWebEvidence({
      ...run,
      recoverUnavailable: true,
    })!;
    if (mode === 'refusal' || mode === 'invalid-citation') {
      await expect(evidence.tool.search(run.request)).rejects.toThrow();
      expect(evidence.snapshot().references).toHaveLength(0);
    } else {
      const result = await evidence.tool.search(run.request);
      if (mode === 'success') {
        if ('status' in result)
          throw new Error('Expected cited public evidence');
        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.locator).toMatchObject({
          sources: publicResponse.citations,
        });
        expect(result.items[0]?.content).toContain(
          'not original source passages',
        );
        expect(evidence.snapshot().references).toHaveLength(1);
        expect(mockCancel).not.toHaveBeenCalled();
      } else {
        expect(result).toMatchObject({ status: 'consent_required' });
        expect(evidence.snapshot().references).toHaveLength(0);
        expect(mockStart).not.toHaveBeenCalled();
        return;
      }
    }
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith(
      {
        model: 'synthetic',
        publicWebQuery:
          'General public health information about: sleep. Guidelines, associations, possible explanations and limitations.',
      },
      'synthetic-search',
      'synthetic-account',
    );
    expect(mockRemove).toHaveBeenCalledTimes(1);
  },
);
