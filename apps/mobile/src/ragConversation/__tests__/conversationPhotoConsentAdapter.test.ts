import { authorizeConversationPhoto } from '../conversationPhotoConsentAdapter';
import {
  currentMedicalDocumentGeneration,
  discardMedicalDocumentFromLifecycle,
  trackStagedMedicalDocument,
} from '../../medicalDocuments/medicalDocumentLifecycle';

const document = {
  id: 'synthetic',
  displayName: 'synthetic.jpg',
  contentHash: `sha256:${'a'.repeat(64)}` as const,
  sections: [
    { id: 'span', text: 'synthetic OCR', startOffset: 0, endOffset: 13 },
  ],
};
const provider = {
  id: 'provider',
  displayName: 'Synthetic provider',
  capabilities: { inputTypes: ['text'] },
} as const;
const selected = {
  provider,
  modelId: 'model',
  recipient: 'recipient',
  remoteProcessing: false,
};
const identity = {
  sessionId: 'session',
  sessionVersion: 0,
  requestId: 'request',
  inputRevision: 1,
};
const payload = () => ({
  messages: [
    {
      role: 'user' as const,
      content: JSON.stringify({
        evidence: [
          {
            evidenceId: 'span',
            sourceKind: 'personal_record',
            content: 'synthetic OCR',
          },
        ],
      }),
    },
  ],
});
const request = (signal: AbortSignal) => ({
  operationRunId: 'run',
  providerId: 'provider',
  modelId: 'model',
  recipient: 'recipient',
  remoteProcessing: false,
  consentScope: {
    purpose: 'record_conversation',
    dataCategories: ['photo_ocr'],
    policyVersion: 'photo-v1',
  },
  allowedScope: { sourceKinds: ['personal_record' as const] },
  payload: payload(),
  signal,
});
afterEach(() => discardMedicalDocumentFromLifecycle(document.id));

test('requires a separate explicit approval even for a local selected provider', async () => {
  trackStagedMedicalDocument(document.id);
  const confirm = jest.fn().mockResolvedValue(true);
  const signal = new AbortController().signal;
  const result = await authorizeConversationPhoto({
    identity,
    document,
    stagingGeneration: currentMedicalDocumentGeneration(),
    selected,
    request: request(signal),
    isCurrent: async () => true,
    confirm,
  });
  expect(result).toBe('authorized');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenCalledWith(
    {
      providerName: 'Synthetic provider',
      modelId: 'model',
      recipient: 'recipient',
      remoteProcessing: false,
    },
    signal,
  );
});

test('denial, changed payload and unsupported provider fail closed', async () => {
  trackStagedMedicalDocument(document.id);
  const signal = new AbortController().signal;
  const base = {
    identity,
    document,
    stagingGeneration: currentMedicalDocumentGeneration(),
    selected,
    request: request(signal),
    isCurrent: async () => true,
  };
  expect(
    await authorizeConversationPhoto({ ...base, confirm: async () => false }),
  ).toBe('consent_required');
  expect(
    await authorizeConversationPhoto({
      ...base,
      request: {
        ...base.request,
        payload: { messages: [{ role: 'user', content: '{}' }] },
      },
      confirm: async () => true,
    }),
  ).toBe('unavailable');
  expect(
    await authorizeConversationPhoto({
      ...base,
      selected: {
        ...selected,
        provider: { ...provider, capabilities: { inputTypes: ['image'] } },
      },
      confirm: async () => true,
    }),
  ).toBe('unavailable');
});

test('a changed payload or deleted source during confirmation cannot be approved', async () => {
  trackStagedMedicalDocument(document.id);
  const signal = new AbortController().signal;
  const outbound = request(signal);
  let current = true;
  const result = await authorizeConversationPhoto({
    identity,
    document,
    stagingGeneration: currentMedicalDocumentGeneration(),
    selected,
    request: outbound,
    isCurrent: async () => current,
    confirm: async () => {
      current = false;
      return true;
    },
  });
  expect(result).toBe('unavailable');
});

test('aborting while the explicit decision is pending stops authorization', async () => {
  trackStagedMedicalDocument(document.id);
  const controller = new AbortController();
  let finish!: (approved: boolean) => void;
  const pending = new Promise<boolean>(resolve => {
    finish = resolve;
  });
  const result = authorizeConversationPhoto({
    identity,
    document,
    stagingGeneration: currentMedicalDocumentGeneration(),
    selected,
    request: request(controller.signal),
    isCurrent: async () => true,
    confirm: () => pending,
  });
  await Promise.resolve();
  controller.abort();
  await expect(result).resolves.toBe('cancelled');
  finish(true);
});

test('a mutated provider payload cannot reuse an earlier approval', async () => {
  trackStagedMedicalDocument(document.id);
  const signal = new AbortController().signal;
  const outbound = request(signal);
  const result = await authorizeConversationPhoto({
    identity,
    document,
    stagingGeneration: currentMedicalDocumentGeneration(),
    selected,
    request: outbound,
    isCurrent: async () => true,
    confirm: async () => {
      outbound.payload.messages[0]!.content = '{}';
      return true;
    },
  });
  expect(result).toBe('unavailable');
});
