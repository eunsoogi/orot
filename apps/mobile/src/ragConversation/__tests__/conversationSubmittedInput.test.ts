import { decodeConversationSubmittedInput } from '../conversationSubmittedInput';

const photo = {
  schemaVersion: 1,
  inputRevision: 2,
  sessionId: 'session',
  requestId: 'request',
  question: '',
  ocr: {
    providerId: 'provider',
    modelId: 'model',
    recipient: 'recipient',
    remoteProcessing: true,
    consentScope: {
      purpose: 'conversation',
      policyVersion: 'v1',
      dataCategories: ['ocr'],
    },
    source: {
      id: '12345678-1234-4234-8234-123456789abc',
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
    deletionGeneration: 3,
    sections: [
      { id: 'section', text: 'Synthetic text', startOffset: 0, endOffset: 14 },
    ],
  },
};

test('keeps a photo-only question empty and accepts a text-only request', () => {
  expect(decodeConversationSubmittedInput(photo)).toEqual(photo);
  const text = {
    schemaVersion: 1,
    inputRevision: 0,
    sessionId: 'session',
    requestId: 'request',
    question: 'Question',
  };
  expect(decodeConversationSubmittedInput(text)).toEqual(text);
  expect(
    decodeConversationSubmittedInput({ ...text, question: '' }),
  ).toBeNull();
});

test('rejects missing provenance, consent scope, OCR text, and accidental preview data', () => {
  expect(
    decodeConversationSubmittedInput({
      ...photo,
      ocr: { ...photo.ocr, consentScope: undefined },
    }),
  ).toBeNull();
  expect(
    decodeConversationSubmittedInput({
      ...photo,
      ocr: {
        ...photo.ocr,
        source: { ...photo.ocr.source, contentHash: 'changed' },
      },
    }),
  ).toBeNull();
  expect(
    decodeConversationSubmittedInput({
      ...photo,
      ocr: {
        ...photo.ocr,
        sections: [{ ...photo.ocr.sections[0], text: ' ' }],
      },
    }),
  ).toBeNull();
  expect(
    decodeConversationSubmittedInput({
      ...photo,
      ocr: { ...photo.ocr, previewData: 'private image' },
    }),
  ).toBeNull();
});
