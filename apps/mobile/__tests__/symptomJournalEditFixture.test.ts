import { createRecoveryRepository } from '../e2e/symptomJournalSaveRecoveryProbeEntry';

jest.mock('../App', () => () => null);
jest.mock('../src/agent/polyfills', () => ({}));
jest.mock('react-native-get-random-values', () => ({}));

describe('symptom journal edit fixture', () => {
  it('keeps the existing recovery fixture empty and rejects editing', async () => {
    const repository = createRecoveryRepository();
    expect(await repository.list()).toEqual([]);
    await expect(
      repository.update('keyboard-seed', {
        description: '아픔',
        bodySite: null,
        severity: 6,
      }),
    ).rejects.toThrow();
  });

  it('opts into one synthetic entry and preserves actual edits across list calls', async () => {
    const repository = createRecoveryRepository(true);
    const [seed] = await repository.list();
    expect(seed).toMatchObject({
      id: 'keyboard-seed',
      description: '아픔',
      severity: 2,
    });
    expect(
      await repository.update('keyboard-seed', {
        description: '아픔',
        bodySite: null,
        severity: 6,
      }),
    ).toMatchObject({ severity: 6 });
    expect(await repository.list()).toMatchObject([
      { description: '아픔', severity: 6 },
    ]);
    expect(
      await repository.update('missing', {
        description: '아픔',
        bodySite: null,
        severity: 8,
      }),
    ).toBeNull();
  });
});
