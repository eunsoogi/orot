import { runSyntheticStages } from '../conversationLeaseProbeStage';

test('reports the failing synthetic stage without exposing the error', async () => {
  const values: string[] = [];
  const failure = new Error('private failure detail');
  await expect(
    runSyntheticStages(
      value => values.push(value),
      async mark => {
        mark('preview-boundary');
        mark('lease-check');
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
  expect(values).toEqual([
    'stage:preview-boundary result:entered',
    'stage:lease-check result:entered',
    'stage:lease-check result:exception',
  ]);
});

test('preserves a successful result without reporting an exception', async () => {
  const values: string[] = [];
  await expect(
    runSyntheticStages(
      value => values.push(value),
      async mark => {
        mark('await-release');
        return 'finished';
      },
    ),
  ).resolves.toBe('finished');
  expect(values).toEqual(['stage:await-release result:entered']);
});
