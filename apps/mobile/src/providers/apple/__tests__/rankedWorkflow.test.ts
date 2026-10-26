import { batch, run } from '../testing/rankedWorkflowFixtures';

describe.each(['Apple', 'ChatGPT'] as const)(
  '%s ranked local evidence workflow',
  kind => {
    it('returns a supported medication answer with exact citations and an honest partial-search flag', async () => {
      const { result, revalidate } = await run(kind);
      if (result.status !== 'result') throw new Error(JSON.stringify(result));
      expect(result.value).toMatchObject({
        answer: expect.stringContaining('아세트아미노펜'),
      });
      expect(result.citations).toEqual([
        expect.objectContaining({ evidenceId: 'e1', evidenceRevision: 'er1' }),
      ]);
      expect(result.coverage[0].truncated).toBe(true);
      expect(revalidate).toHaveBeenCalled();
    });

    it.each([
      [
        'missing rows',
        {
          ...batch,
          coverage: [{ ...batch.coverage[0], gaps: ['Unreadable record'] }],
        },
      ],
      [
        'unknown truncation',
        {
          ...batch,
          coverage: [{ ...batch.coverage[0], selectionMethod: undefined }],
        },
      ],
      [
        'conflicting records',
        { ...batch, conflicts: ['Conflicting dose records'] },
      ],
      [
        'empty records',
        {
          ...batch,
          items: [],
          coverage: [
            { ...batch.coverage[0], searchedSourceIds: [], returnedCount: 0 },
          ],
        },
      ],
    ] as const)('does not present an answer for %s', async (_, evidence) => {
      expect((await run(kind, evidence)).result.status).not.toBe('result');
    });

    it('rejects a citation whose current row changed or was deleted during generation', async () => {
      const { result, revalidate } = await run(kind, batch, { current: false });
      expect(result.status).not.toBe('result');
      expect(revalidate).toHaveBeenCalled();
    });

    it('rejects a fabricated citation even when the model claims success', async () => {
      const { result } = await run(kind, batch, {
        output: {
          type: 'result',
          value: { answer: '합성 답변' },
          citations: ['unknown'],
        },
      });
      expect(result.status).not.toBe('result');
    });

    it('rejects a late provider result after cancellation', async () => {
      const controller = new AbortController();
      const { result } = await run(kind, batch, {
        controller,
        beforeReply: () => controller.abort(),
      });
      expect(result.status).toBe('cancelled');
    });
  },
);
