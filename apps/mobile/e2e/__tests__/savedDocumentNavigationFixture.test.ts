import type { RecordRepository } from '@orot/storage';
import { prepareSavedDocumentNavigation } from '../savedDocumentNavigationFixture';
const settings = {
  OROT_TEST_PROFILE: 'core',
  OROT_E2E_PROBE: 'medical-document-import',
  OROT_TEST_SAVED_DOCUMENT_NAVIGATION: 'synthetic',
};
const get = jest.fn();
const put = jest.fn();
const repository = jest.fn(
  async () => ({ get, put }) as unknown as RecordRepository,
);
beforeEach(() => jest.clearAllMocks());

test('does not open storage without every explicit synthetic opt-in', async () => {
  for (const key of Object.keys(settings))
    await prepareSavedDocumentNavigation(
      { ...settings, [key]: undefined },
      repository,
    );
  expect(repository).not.toHaveBeenCalled();
});
test('seeds four reserved local source records and is idempotent', async () => {
  get.mockResolvedValue(null);
  await prepareSavedDocumentNavigation(settings, repository);
  expect(put).toHaveBeenCalledTimes(4);
  const records = new Map(put.mock.calls.map(([, value]) => [value.id, value]));
  get.mockImplementation(async (_, id) => records.get(id));
  await prepareSavedDocumentNavigation(settings, repository);
  expect(put).toHaveBeenCalledTimes(4);
});
test('refuses conflicting IDs and propagates unavailable storage', async () => {
  get.mockResolvedValue({ title: 'Existing record' });
  await expect(
    prepareSavedDocumentNavigation(settings, repository),
  ).rejects.toThrow('already exists');
  expect(put).not.toHaveBeenCalled();
  repository.mockRejectedValueOnce(new Error('locked'));
  await expect(
    prepareSavedDocumentNavigation(settings, repository),
  ).rejects.toThrow('locked');
});
