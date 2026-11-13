import { prepareMedicalDocumentPhotoAppearance } from '../medicalDocumentPhotoAppearanceFixture';

const settings = {
  OROT_TEST_PROFILE: 'core',
  OROT_E2E_PROBE: 'medical-document-import',
  OROT_TEST_ASSISTANT_APPEARANCE: 'synthetic',
};
const store = { load: jest.fn(), save: jest.fn() };
beforeEach(() => jest.resetAllMocks());

test('requires the complete explicit test-entry opt-in', async () => {
  for (const key of Object.keys(settings)) {
    await prepareMedicalDocumentPhotoAppearance(
      { ...settings, [key]: undefined },
      store,
    );
  }
  expect(store.load).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

test('preserves an existing persisted choice', async () => {
  store.load.mockResolvedValue({ avatar: 'leaf', name: 'Saved' });
  await prepareMedicalDocumentPhotoAppearance(settings, store);
  expect(store.save).not.toHaveBeenCalled();
});

test('commits the synthetic prerequisite when unconfigured', async () => {
  store.load.mockResolvedValue(null);
  await prepareMedicalDocumentPhotoAppearance(settings, store);
  expect(store.save).toHaveBeenCalledWith({ avatar: 'neutral', name: null });
});

test('propagates storage failure rather than admitting the app', async () => {
  store.load.mockRejectedValue(new Error('locked'));
  await expect(
    prepareMedicalDocumentPhotoAppearance(settings, store),
  ).rejects.toThrow('locked');
  expect(store.save).not.toHaveBeenCalled();
  store.load.mockResolvedValue(null);
  store.save.mockRejectedValue(new Error('write'));
  await expect(
    prepareMedicalDocumentPhotoAppearance(settings, store),
  ).rejects.toThrow('write');
});
