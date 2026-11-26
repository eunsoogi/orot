import { agentMemoryDatabaseFacade } from '../../storage/agentMemoryDatabaseFacade';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { bindTranscriptCorrectionVisibility } from '../../storage/transcriptCorrectionVisibility';
import { consent, sourceId } from '../__fixtures__/sqliteReview';
import { fixture, harness } from '../__fixtures__/longReviewHarness';
import { createRecordRepository } from '@orot/storage';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../aiFeatures/integration/provider', () => ({
  resolveSelectedAiProvider: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test('a same-owner committed correction retires the exact published review without another read', async () => {
  const f = await harness();
  try {
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    expect(f.controller.state.candidates).not.toHaveLength(0);
    const owner = await openLocalAgentMemoryDatabase();
    const records = bindTranscriptCorrectionVisibility(
      f.repository,
      agentMemoryDatabaseFacade(owner),
    );
    const [unrelated] = await records.transcripts.listForRecording(sourceId);
    expect(unrelated).toBeDefined();
    await records.transcripts.correct(
      unrelated!.id,
      'Synthetic correction to another recording.',
      unrelated!.recordedAt,
    );
    expect(f.controller.state.status).toBe('pending');

    await records.transcripts.correct(
      f.final.id,
      'Synthetic correction to the reviewed recording.',
      f.final.recordedAt,
    );
    expect(f.controller.state.status).toBe('unavailable');
    expect(f.controller.state.pending).toBeUndefined();
    expect(f.controller.state.candidates).toEqual([]);
    expect(f.listeners.size).toBe(0);
    expect(f.calls()).toBe(2);
    expect(await fixture.rows()).toEqual([]);
  } finally {
    f.controller.dispose();
  }
});

test.each(['raw-wal', 'other-facade'] as const)(
  'a %s commit has no local wake but still cannot save a stale review',
  async mode => {
    const f = await harness();
    const second = fixture.openSecondConnection();
    try {
      await f.controller.start(consent);
      expect(f.controller.state.status).toBe('pending');
      const repo = createRecordRepository(second.database);
      const writer =
        mode === 'raw-wal'
          ? repo
          : bindTranscriptCorrectionVisibility(
              repo,
              guardedNativeDatabase(second.database),
            );
      await writer.transcripts.correct(
        f.final.id,
        'Synthetic edit on a distinct SQLite connection.',
        f.final.recordedAt,
      );
      expect(f.controller.state.status).toBe('pending');
      await f.controller.decide('approve');
      expect(f.controller.state.status).toBe('unavailable');
      expect(await fixture.rows()).toEqual([]);
      expect(f.calls()).toBe(2);
    } finally {
      second.close();
      f.controller.dispose();
    }
  },
);
