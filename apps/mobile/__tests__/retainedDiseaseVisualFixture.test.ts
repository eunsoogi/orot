import {
  retainedDiseaseVisualResult,
  syntheticSummary,
} from '../e2e/summaryVisualFixtures';

jest.mock('../src/storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('the retained disease fixture preserves the synthetic source reference without dispatching a model', () => {
  const result = retainedDiseaseVisualResult();
  expect(result.status).toBe('workflow');
  if (result.status !== 'workflow' || result.result.status !== 'result')
    throw new Error('Expected a synthetic result.');
  expect(result.result.value.hypotheses[0]?.title).toBe('합성 가능성 평가');
  expect(result.result.citations).toEqual(
    syntheticSummary.hypotheses[0]?.supportingEvidence,
  );
});
