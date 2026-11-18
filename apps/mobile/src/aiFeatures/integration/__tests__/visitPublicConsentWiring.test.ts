import { visitQuestionPublicSearch } from '../visitQuestionPublicSearch';
import { createPublicWebEvidence } from '../publicWebEvidence';
import type { SelectedAiResolution } from '../provider';

jest.mock('../publicWebEvidence', () => ({
  createPublicWebEvidence: jest.fn(() => null),
}));

test('visit public research receives the actual consent port without converting it to a boolean', async () => {
  const consent = {
    authorize: jest.fn(async () => 'renewal_required' as const),
    isAuthorizationCurrent: jest.fn(() => false),
    subscribeAuthorizationInvalidation: jest.fn(() => () => {}),
  };
  const confirm = jest.fn(async () => true);
  await visitQuestionPublicSearch({
    selected: { status: 'ready', provider: {} } as Extract<
      SelectedAiResolution,
      { status: 'ready' }
    >,
    query: 'synthetic controlled topic',
    signal: new AbortController().signal,
    consent,
    confirm,
  });
  expect(createPublicWebEvidence).toHaveBeenCalledWith(
    expect.objectContaining({ consent }),
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(consent.authorize).not.toHaveBeenCalled();
});
