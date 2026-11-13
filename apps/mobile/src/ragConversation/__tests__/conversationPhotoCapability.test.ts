import { photoEvidenceCapability } from '../conversationPhotoCapability';
import { APPLE_PROVIDER_CAPABILITIES } from '@orot/provider-apple';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeBridge,
} from '@orot/provider-openai';

const document = {
  id: 'synthetic',
  displayName: 'synthetic.jpg',
  contentHash: `sha256:${'a'.repeat(64)}` as const,
  sections: [
    {
      id: 'synthetic-text',
      text: 'synthetic text',
      startOffset: 0,
      endOffset: 14,
    },
  ],
};

test('selects OCR text for the actual Apple provider capability without claiming image support', () => {
  expect(APPLE_PROVIDER_CAPABILITIES.inputTypes).not.toContain('image');
  expect(photoEvidenceCapability(APPLE_PROVIDER_CAPABILITIES, document)).toBe(
    'ocr',
  );
});

test('the selected ChatGPT plan adapter also declares text rather than image input', () => {
  const provider = createChatGPTPlanProvider({
    bridge: {} as ChatGPTPlanNativeBridge,
    issuedClientID: 'synthetic',
    model: { slug: 'synthetic', displayName: 'Synthetic' },
  });
  expect(provider.capabilities.inputTypes).toEqual(['text']);
  expect(photoEvidenceCapability(provider.capabilities, document)).toBe('ocr');
});

test('rejects an unsupported provider or absent OCR rather than dropping the attachment', () => {
  expect(photoEvidenceCapability({ inputTypes: ['image'] }, document)).toBe(
    'unsupported',
  );
  expect(
    photoEvidenceCapability(
      { inputTypes: ['text'] },
      { ...document, sections: [] },
    ),
  ).toBe('empty');
  expect(
    photoEvidenceCapability(
      { inputTypes: ['text'] },
      { ...document, sections: [{ ...document.sections[0]!, text: '  ' }] },
    ),
  ).toBe('empty');
});
