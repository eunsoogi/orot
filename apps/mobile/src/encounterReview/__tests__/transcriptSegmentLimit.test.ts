import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';
import { createReviewDiagnostics } from '../diagnostics';

const fixture = sqliteReviewFixture();

test.each([8, 9, 145])(
  'takes a canonical stored transcript with %s distinct current segments through the review boundary',
  async count => {
    const recordingId = sourceId + ':canonical-' + count;
    const source = await fixture.repository().get('source_record', sourceId);
    if (!source) throw new Error('Fixture recording missing.');
    const [original] = await fixture
      .repository()
      .transcripts.listForRecording(sourceId);
    if (!original) throw new Error('Fixture transcript missing.');
    const recordingDurationMs = Math.max(
      original.recordingDurationMs,
      2900 + count,
    );
    await fixture.repository().put('source_record', {
      ...source,
      id: recordingId,
      recordingDurationMs,
    });
    await fixture.repository().transcripts.append(
      Array.from({ length: count }, (_, index) => {
        const ordinal = index;
        const transcriptId =
          recordingId + (ordinal ? ':test-part-' + ordinal : ':segment');
        return {
          ...original,
          id: transcriptId + ':r1',
          transcriptId,
          recordingSourceId: recordingId,
          recordingDurationMs,
          provenance: {
            ...original.provenance,
            sourceRecordIds: [recordingId],
          },
          segmentOrdinal: ordinal,
          audioRange: ordinal
            ? { startMs: 2900 + index, endMs: 2901 + index }
            : original.audioRange,
          text: ordinal ? '합성 일반 문장입니다.' : original.text,
        };
      }),
    );
    const segments = await fixture
      .repository()
      .transcripts.listForRecording(recordingId);
    expect(segments).toHaveLength(count);
    await fixture
      .repository()
      .transcripts.correct(
        segments.at(-1)!.id,
        'Fixed synthetic closing segment.',
        segments.at(-1)!.recordedAt,
      );
    let diagnostics: ReturnType<typeof createReviewDiagnostics> | undefined;
    const { controller, synthetic } = fixture.controllerFor(
      false,
      true,
      calls => {
        diagnostics = createReviewDiagnostics(
          recordingId,
          async () => (await fixture.rows()).length,
          calls,
        );
        return diagnostics;
      },
      recordingId,
    );
    const authorize = jest.fn(async () => 'authorized' as const);
    await controller.start({ authorize });
    if (count > 8) expect(authorize).not.toHaveBeenCalled();
    expect(await fixture.rows()).toHaveLength(0);
    expect(synthetic.calls()).toBe(count === 8 ? 1 : 0);
    if (count === 8) {
      expect(controller.state.status).toBe('pending');
    } else {
      expect(await diagnostics?.snapshot()).toMatchObject({
        failure: { stage: 'transcript_read', category: 'unavailable' },
        modelCalls: 0,
        recordCount: 0,
      });
      expect(controller.state.status).toBe('transcript-too-long');
    }
  },
);
