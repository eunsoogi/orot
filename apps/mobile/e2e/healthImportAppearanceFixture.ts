import type { appearanceStore } from '../src/assistantAppearance/appearanceStore';

/** Only the explicit health-import test launch may prepare a synthetic preference. */
export async function prepareHealthImportAppearance(
  settings: Record<string, unknown> | undefined,
  store: Pick<typeof appearanceStore, 'load' | 'save'>,
): Promise<void> {
  if (
    settings?.OROT_HEALTH_IMPORT_APPEARANCE !== 'synthetic' ||
    (settings.OROT_TEST_SCENARIO !== 'common-observations' &&
      settings.OROT_TEST_SCENARIO !== 'blood-pressure')
  )
    return;
  // Keep any configured choice and propagate load/commit errors to the fixture's failed state.
  if (await store.load()) return;
  await store.save({ avatar: 'neutral', name: null });
}
