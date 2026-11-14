import { seedSyntheticEncounter } from '../../agent/encounter/syntheticFixture';
import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';

const fixture = sqliteReviewFixture();
const correctionTime = '2026-11-14T08:00:01.000Z';

test('future fixed-clock seeds reject real-time corrections without changing revision history', async () => {
  const repository = fixture.repository();
  const [original] = await repository.transcripts.listForRecording(sourceId);
  await expect(
    repository.transcripts.correct(original.id, '수정한 전사', correctionTime),
  ).rejects.toThrow(
    'A transcript correction cannot predate its prior revision.',
  );
  expect(await repository.transcripts.listForRecording(sourceId)).toEqual([
    original,
  ]);
});

test('native wall-clock seeds allow the first correction and retain the original evidence', async () => {
  const repository = fixture.repository();
  const nativeSource = 'synthetic-native-clock';
  await seedSyntheticEncounter(
    repository,
    nativeSource,
    '2026-11-14T08:00:00.000Z',
  );
  const [original] =
    await repository.transcripts.listForRecording(nativeSource);
  const corrected = await repository.transcripts.correct(
    original.id,
    '수정한 전사',
    correctionTime,
  );
  expect(corrected).toMatchObject({
    text: '수정한 전사',
    revision: 2,
    supersedesId: original.id,
    recordedAt: correctionTime,
    reviewState: { status: 'needs_review' },
  });
  expect(await repository.transcripts.listForRecording(nativeSource)).toEqual([
    original,
    corrected,
  ]);
  fixture.reopen();
  expect(
    await fixture.repository().transcripts.listForRecording(nativeSource),
  ).toEqual([original, corrected]);
});
