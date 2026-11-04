import { assertCurrentVisitQuestionRecord } from '../persistenceValidation';

test('does not save a generated artifact as independently verified question evidence', async () => {
  await expect(
    assertCurrentVisitQuestionRecord(
      {} as never,
      { sourceKind: 'generated_artifact' } as never,
      {} as never,
    ),
  ).rejects.toThrow('Generated artifact lineage is unavailable');
});
