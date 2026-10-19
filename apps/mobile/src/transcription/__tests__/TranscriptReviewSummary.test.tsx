import { render, screen } from '@testing-library/react-native';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import TranscriptReviewSummary from '../TranscriptReviewSummary';
import {
  source,
  original,
} from '../testSupport/transcriptEvidenceServiceFixtures';

const reviewed = {
  status: 'reviewed' as const,
  reviewerId: 'reviewer-fixture',
  reviewedAt: '2026-10-05T10:30:00.000Z',
};

// Requirement 11: the overall review label must not hide unfinished or corrected later segments.
test.each([
  ['unreviewed', '검토 전 초안'],
  ['needs_review', '수정됨 · 다시 확인 필요'],
  ['reviewed', '검토됨'],
] as const)(
  'includes a later %s segment in the recording review state',
  async (status, label) => {
    const segments: TranscriptEvidenceSegment[] = [
      { ...original, reviewState: reviewed },
      {
        ...original,
        id: 'second:r1',
        transcriptId: 'second',
        segmentOrdinal: 1,
        reviewState:
          status === 'reviewed'
            ? reviewed
            : status === 'needs_review'
              ? { status, reason: 'User corrected this segment.' }
              : { status },
      },
    ];
    await render(
      <TranscriptReviewSummary source={source} segments={segments} />,
    );
    expect(screen.getByTestId('transcript-summary-title')).toHaveTextContent(
      label,
    );
  },
);
