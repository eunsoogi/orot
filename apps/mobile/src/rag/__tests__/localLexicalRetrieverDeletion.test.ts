import {
  lexicalChunk,
  lexicalSetup,
} from '../testSupport/lexicalRetrieverFixtures';

describe('lexical retriever evidence eligibility', () => {
  it.each(['source', 'provenance', 'record', 'chunk'])(
    'excludes a deleted %s before search and rejects stale store references',
    async kind => {
      const { chunks, textStore, removalReader } = lexicalSetup();
      const removed = chunks[0];
      const provenance = 'upstream-record';
      const candidate = {
        ...removed,
        metadata: { ...removed.metadata, sourceRecordIds: [provenance] },
      };
      const setup = lexicalSetup({
        chunks: [candidate, chunks[1]],
        textStore,
        removalReader,
      });
      const sourceId =
        kind === 'source'
          ? removed.metadata.sourceId
          : kind === 'record'
            ? removed.metadata.evidenceId
            : provenance;
      removalReader.findRemovedEvidence.mockResolvedValue({
        sourceRecordIds: kind === 'chunk' ? [] : [sourceId],
        chunkIds: kind === 'chunk' ? [removed.id] : [],
      });
      (textStore.search as jest.Mock).mockResolvedValue([
        { chunkId: removed.id },
        { chunkId: chunks[1].id },
      ]);
      await expect(setup.retriever.invoke('진료')).resolves.toMatchObject([
        { id: chunks[1].id },
      ]);
      expect(textStore.search).toHaveBeenCalledWith(
        '진료',
        [chunks[1]],
        20,
        undefined,
      );
    },
  );

  it('rechecks deletion on each invocation of a retained candidate page', async () => {
    const setup = lexicalSetup();
    await expect(setup.retriever.invoke('진료')).resolves.toHaveLength(2);
    setup.removalReader.findRemovedEvidence.mockResolvedValue({
      sourceRecordIds: setup.chunks.map(chunk => chunk.metadata.sourceId),
      chunkIds: [],
    });
    await expect(setup.retriever.invoke('진료')).resolves.toEqual([]);
    expect(setup.textStore.search).toHaveBeenCalledTimes(1);
    expect(setup.removalReader.findRemovedEvidence).toHaveBeenCalledTimes(2);
  });

  it('preserves root, external provenance and manual structured row semantics', async () => {
    const root = lexicalChunk('root');
    const transcript = {
      ...root,
      metadata: {
        ...root.metadata,
        recordType: 'transcript_segment' as const,
        evidenceLocator: {
          kind: 'audio_time_range' as const,
          startMs: 0,
          endMs: 100,
        },
      },
    };
    const external = lexicalChunk('external');
    const manual = lexicalChunk('manual');
    const chunks = [
      transcript,
      {
        ...external,
        metadata: {
          ...external.metadata,
          sourceRecordIds: ['external-sample'],
        },
      },
      {
        ...manual,
        metadata: {
          ...manual.metadata,
          sourceId: manual.metadata.evidenceId,
          sourceRecordIds: [],
        },
      },
    ];
    const { retriever, removalReader } = lexicalSetup({ chunks });
    await expect(retriever.invoke('진료')).resolves.toHaveLength(3);
    expect(removalReader.findRemovedEvidence).toHaveBeenCalledWith(
      [
        'source-root',
        'source-external',
        'external-sample',
        'record-external',
        'record-manual',
      ],
      ['root', 'external', 'manual'],
      ['source-root'],
      ['record-external', 'record-manual'],
    );
  });

  it('fails closed when persisted removal status cannot be read', async () => {
    const { retriever, textStore, removalReader } = lexicalSetup();
    const failure = new Error('Deletion lookup failed');
    removalReader.findRemovedEvidence.mockRejectedValue(failure);
    await expect(retriever.invoke('진료')).rejects.toBe(failure);
    expect(textStore.search).not.toHaveBeenCalled();
  });
});
