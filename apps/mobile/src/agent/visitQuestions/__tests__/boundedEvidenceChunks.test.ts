import type { LocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createBoundedVisitQuestionChunkBuilder } from '../boundedEvidenceChunks';

function fixture() {
  const readCandidates = jest.fn(async () => ({
    catalog: { inventoryComplete: true, totalRecordCount: 500000 },
    candidates: [
      { kind: 'health_observation', record: { id: 'observation-42' } },
    ],
  }));
  const loadCurrentChunks = jest.fn(async () => []);
  const data = {
    readCandidates,
    loadCurrentChunks,
  } as unknown as LocalEvidenceData;
  const loadData = jest.fn(async () => data);
  return {
    loadData,
    readCandidates,
    loadCurrentChunks,
    build: createBoundedVisitQuestionChunkBuilder(loadData),
  };
}

test('opens no source before a model query and materializes only the selected window', async () => {
  const subject = fixture();
  expect(subject.loadData).not.toHaveBeenCalled();
  const signal = new AbortController().signal;
  await subject.build({} as never, { query: '최근 혈압 변화', signal });
  expect(subject.readCandidates).toHaveBeenCalledWith('최근 혈압 변화', signal);
  expect(subject.loadCurrentChunks).toHaveBeenCalledWith(
    [{ kind: 'health_observation', id: 'observation-42' }],
    signal,
  );
});

test('revalidates cited identities without searching or enumerating the corpus again', async () => {
  const subject = fixture();
  const identities = [
    { kind: 'health_observation' as const, id: 'observation-42' },
  ];
  await subject.build({} as never, { identities });
  expect(subject.readCandidates).not.toHaveBeenCalled();
  expect(subject.loadCurrentChunks).toHaveBeenCalledWith(identities, undefined);
});

test('rejects missing query and cancellation before opening local sources', async () => {
  const subject = fixture();
  await expect(subject.build({} as never)).rejects.toThrow('required');
  const controller = new AbortController();
  controller.abort();
  await expect(
    subject.build({} as never, { query: '혈압', signal: controller.signal }),
  ).rejects.toThrow('cancelled');
  expect(subject.loadData).not.toHaveBeenCalled();
});
