import type { appearanceStore } from '../src/assistantAppearance/appearanceStore';

/** Seeds only an opted-in test entry; production never interprets these flags. */
export async function prepareMedicalDocumentPhotoAppearance(
  settings: Record<string, unknown> | undefined,
  store: Pick<typeof appearanceStore, 'load' | 'save'>,
): Promise<void> {
  if (
    settings?.OROT_TEST_PROFILE !== 'core' ||
    settings.OROT_E2E_PROBE !== 'medical-document-import' ||
    settings.OROT_TEST_ASSISTANT_APPEARANCE !== 'synthetic'
  )
    return;
  // Preserve persisted choices and wait for the encrypted commit before mounting the real gate.
  if (await store.load()) return;
  await store.save({ avatar: 'neutral', name: null });
}
