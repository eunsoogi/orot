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
    findIdentifiers: jest.fn(async () => ['outside record / 42']),
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

test('protects a candidate-external identifier in text without changing local citation identity or source', async () => {
  const subject = fixture();
  const original = {
    id: 'chunk-1',
    text: 'Related to outside record / 42. Keep this clinical text.',
    metadata: { sourceId: 'observation-42', evidenceId: 'observation-42' },
  };
  subject.loadCurrentChunks.mockResolvedValue([original] as never);
  const result = await subject.build({} as never, { query: 'recent records' });
  expect(result[0]?.text).not.toContain('outside record / 42');
  expect(result[0]?.text).toContain('Keep this clinical text.');
  expect(result[0]?.metadata).toEqual(original.metadata);
  expect(original.text).toContain('outside record / 42');
  const reread = await subject.build({} as never, {
    identities: [{ kind: 'health_observation', id: 'observation-42' }],
  });
  expect(reread).toEqual(result);
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
