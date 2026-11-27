import {
  notifyLocalDataCleared,
  notifyLocalSourceDeleted,
} from '../../storage/localDataClearEvents';
import { consent } from '../__fixtures__/sqliteReview';
import {
  fixture,
  harness,
  recordingId,
} from '../__fixtures__/longReviewHarness';

import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { SqlCipherAgentMemoryStorage } from '../../storage/agentMemoryStorage';
import { createEncounterReviewService } from '../service';
import { EncounterReviewController } from '../controller';
import { openEncounterReviewSessions } from '../openSessions';

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

test.each(['save', 'edit', 'lock', 'dispose'] as const)(
  'production long route reaches only a complete exact review and handles %s',
  async mode => {
    const f = await harness();
    try {
      await f.controller.start(consent);
      expect(f.controller.state.status).toBe('pending');
      expect(f.controller.state.pending?.segments).toHaveLength(9);
      expect(f.controller.state.pending?.segments.at(-1)?.id).toBe(f.final.id);
      expect(f.controller.state.candidates[0]?.evidence[0]?.segmentId).toBe(
        f.final.id,
      );
      expect(f.calls()).toBe(2);
      expect(await fixture.rows()).toHaveLength(0);
      if (mode === 'lock') {
        f.listeners.forEach(listener =>
          listener({ kind: 'protectedData', available: false }),
        );
        expect(f.controller.state.status).toBe('unavailable');
      } else if (mode === 'dispose') {
        f.controller.dispose();
        f.controller.activate();
        await f.controller.restore();
        expect(f.controller.state.status).not.toBe('pending');
      } else {
        if (mode === 'edit')
          await f.repository.transcripts.correct(
            f.final.id,
            'Retired.',
            f.final.recordedAt,
          );
        await f.controller.decide('approve');
        expect(f.controller.state.status).toBe(
          mode === 'save' ? 'saved' : 'unavailable',
        );
      }
      expect(await fixture.rows()).toHaveLength(mode === 'save' ? 1 : 0);
      expect(f.calls()).toBe(2);
    } finally {
      f.controller.dispose();
    }
  },
);

test('reviews all 33 on-device candidates; explicitly saves only the terminal evidence', async () => {
  const f = await harness(33);
  try {
    await f.controller.start(consent);
    expect(f.controller.state.status).toBe('pending');
    expect(f.controller.state.candidates).toHaveLength(33);
    expect(f.controller.state.selected).toEqual([]);
    expect(f.calls()).toBe(5);
    expect(await fixture.rows()).toHaveLength(0);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('pending');
    expect(await fixture.rows()).toHaveLength(0);
    const last = f.controller.state.candidates.at(-1)!;
    expect(last.evidence[0]?.segmentId).toBe(f.final.id);
    f.controller.toggle(last.id);
    await f.controller.decide('approve');
    expect(f.controller.state.status).toBe('saved');
    expect(await fixture.rows()).toHaveLength(1);
    expect(f.calls()).toBe(5);
  } finally {
    f.controller.dispose();
  }
});

test.each(['logical', 'physical'] as const)(
  'long review cannot save or cold-restore after %s recording removal',
  async mode => {
    const f = await harness();
    const cold = new EncounterReviewController(
      recordingId,
      createEncounterReviewService(),
      jest.fn(),
    );
    try {
      await f.controller.start(consent);
      expect(f.controller.state.status).toBe('pending');
      const thread = f.controller.state.pending?.threadId;
      expect(thread).toBeDefined();
      expect(f.calls()).toBe(2);
      const consentChecks = consent.authorize.mock.calls.length;
      const { discovery } = await openEncounterReviewSessions(recordingId);
      expect((await discovery.read())?.threadId).toBe(thread);

      if (mode === 'logical') {
        await new SqlCipherAgentMemoryStorage(
          fixture.database(),
        ).markSourceRemoved(recordingId);
        expect(await f.repository.sourceRecords.get(recordingId)).toMatchObject(
          {
            id: recordingId,
            sourceKind: 'audio_recording',
          },
        );
      } else {
        expect(await f.repository.sourceRecords.delete(recordingId)).toBe(true);
        expect(
          await f.repository.transcripts.listForRecording(recordingId),
        ).toEqual([]);
      }
      const binding = await fixture
        .database()
        .execute(
          'SELECT thread_id FROM langgraph_checkpoint_sources WHERE source_record_id = ?',
          [recordingId],
        );
      expect(binding.rows).toEqual([]);
      expect(await discovery.read()).toBeNull();
      await f.controller.decide('approve');
      expect(f.controller.state.status).toBe('unavailable');
      expect(await fixture.rows()).toEqual([]);

      f.controller.dispose();
      fixture.reopen();
      jest
        .mocked(openLocalAgentMemoryDatabase)
        .mockResolvedValue(guardedNativeDatabase(fixture.database()));
      await cold.restore();
      expect(cold.state.status).toBe('unavailable');
      expect(cold.state.pending).toBeUndefined();
      expect(cold.state.candidates).toEqual([]);
      expect(f.calls()).toBe(2);
      expect(consent.authorize.mock.calls).toHaveLength(consentChecks);
      expect(await fixture.rows()).toEqual([]);
      expect(
        (
          await fixture
            .database()
            .execute(
              "SELECT checkpoint_key FROM healthkit_sync_checkpoints WHERE checkpoint_key GLOB 'encounter-approval:*' AND json_extract(value, '$.sourceId') = ?",
              [recordingId],
            )
        ).rows,
      ).toEqual([]);
    } finally {
      f.controller.dispose();
      cold.dispose();
    }
  },
);

test.each(['selected recording deletion', 'local clear'] as const)(
  'retires the same still-mounted long review after %s',
  async mode => {
    const f = await harness();
    try {
      await f.controller.start(consent);
      expect(f.controller.state.status).toBe('pending');
      const source = f.controller.state.pending!.sourceId;
      notifyLocalSourceDeleted('healthkit', new Set([source]));
      notifyLocalSourceDeleted('local', new Set(['unrelated-recording']));
      expect(f.controller.state.status).toBe('pending');

      if (mode === 'selected recording deletion') {
        await f.repository.sourceRecords.delete(source);
        expect(await f.repository.get('source_record', source)).toBeNull();
        notifyLocalSourceDeleted('local', new Set([source]));
      } else {
        await f.repository.deleteAllLocalData();
        notifyLocalDataCleared();
      }
      expect(f.controller.state.status).toBe('unavailable');
      expect(f.controller.state.candidates).toEqual([]);
      expect(f.listeners.size).toBe(0);
      await f.controller.decide('approve');
      expect(await fixture.rows()).toEqual([]);
      expect(f.calls()).toBe(2);
    } finally {
      f.controller.dispose();
    }
  },
);
