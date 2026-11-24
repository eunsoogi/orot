import type { SelectedAiResolution } from '../../aiFeatures/integration/provider';
import {
  syntheticEncounterModel,
  syntheticEncounterTime,
} from '../../agent/encounter/syntheticFixture';
import { sqliteReviewFixture, sourceId } from '../__fixtures__/sqliteReview';
import { createEncounterReviewService } from '../service';

const fixture = sqliteReviewFixture();

test.each([
  { corrected: false, status: 'pending', calls: 1 },
  { corrected: true, status: 'unavailable', calls: 0 },
])(
  'keeps the initial transcript revision through model selection (corrected: $corrected)',
  async ({ corrected, status, calls }) => {
    const synthetic = syntheticEncounterModel(sourceId, true);
    let notifySelection!: () => void;
    const selectionStarted = new Promise<void>(resolve => {
      notifySelection = resolve;
    });
    let releaseSelection!: () => void;
    const heldSelection = new Promise<void>(resolve => {
      releaseSelection = resolve;
    });
    const service = createEncounterReviewService(
      async (): Promise<SelectedAiResolution> => {
        notifySelection();
        await heldSelection;
        return {
          status: 'ready',
          selection: {
            providerId: synthetic.model.provider.id,
            modelId: 'synthetic',
          },
          option: {
            provider: synthetic.model.provider,
            modelId: 'synthetic',
            displayName: 'Synthetic',
            privacyBoundary: 'selected-context-remote',
            availability: { status: 'available' },
          },
          provider: synthetic.model.provider,
          modelId: 'synthetic',
          recipient: 'synthetic-recipient',
          remoteProcessing: true,
        };
      },
    );
    const consent = {
      authorize: jest.fn(async () => 'authorized' as const),
      isAuthorizationCurrent: jest.fn(() => true),
    };
    const result = service.start(
      sourceId,
      consent,
      new AbortController().signal,
    );
    await selectionStarted;
    try {
      if (corrected)
        await fixture
          .repository()
          .transcripts.correct(
            sourceId + ':segment:r1',
            'Corrected synthetic text.',
            syntheticEncounterTime,
          );
    } finally {
      releaseSelection();
    }
    expect((await result).status).toBe(status);
    expect(synthetic.calls()).toBe(calls);
    expect(consent.authorize).toHaveBeenCalledTimes(calls);
    expect(await fixture.rows()).toHaveLength(0);
  },
);
