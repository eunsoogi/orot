import {
  autoLocalConversationMemoryIdPrefix,
  readManualHistoryEntry,
} from '@orot/storage';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { createOrdinaryConversationMemoryEnrollmentStore } from '../../storage/ordinaryConversationMemoryEnrollment';
import { saveOrdinaryConversationMemoryNote } from '../../storage/ordinaryConversationMemoryNote';
import { createConversationOrdinaryMemoryOwner } from '../conversationOrdinaryMemoryOwner';

function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const wait = new Promise<T>(resolve => {
    settle = resolve;
  });
  return { wait, settle };
}

const answers = [
  [
    'first',
    'For future replies, I prefer concise answers.',
    '2026-11-25T10:01:00.000Z',
  ],
  [
    'second',
    'For future replies, I prefer answers in Korean.',
    '2026-11-25T10:02:00.000Z',
  ],
  [
    'third',
    'For future replies, I prefer one question at a time.',
    '2026-11-25T10:03:00.000Z',
  ],
] as const;
const sessionId = 'synthetic-current-session';
const sessionVersion = 0;
const dispositions = [
  'next',
  'overlap',
  'saturation',
  'no-proposal',
  'no-grant',
  'cancel-all',
  'revoke-all',
  'retired-source',
  'typed-entry',
] as const;

test.each(dispositions)(
  'detached automatic note ownership with exact held completed replies: %s',
  async mode => {
    const fixture = await healthContextFixture();
    try {
      const { database } = fixture;
      const storage = createConversationArtifactStorage(database);
      await storage.createSession(sessionId, await storage.currentGeneration());
      const deviceEpoch = 'a'.repeat(64);
      const enrollment =
        createOrdinaryConversationMemoryEnrollmentStore(database);
      const receipt = await enrollment.replace(
        await enrollment.read(),
        deviceEpoch,
        () => true,
      );
      if (!receipt) throw new Error('Synthetic consent could not be seeded.');
      function hold() {
        return {
          held: deferred<void>(),
          entered: deferred<void>(),
          settled: deferred<boolean>(),
        };
      }
      const jobs = new Map<string, ReturnType<typeof hold>>();
      let captureEnabled = true;
      const owner = createConversationOrdinaryMemoryOwner({
        capture: async scope =>
          captureEnabled && scope === 'reply-preferences'
            ? {
                database,
                generation: receipt.generation,
                deviceEpoch,
                scope,
                isCurrent: () => true,
              }
            : undefined,
        async save(capture, original, current) {
          const slot = jobs.get(original.requestId);
          if (!slot) throw new Error('Unexpected held settlement.');
          slot.entered.settle(undefined);
          await slot.held.wait;
          try {
            const saved = await saveOrdinaryConversationMemoryNote(
              capture,
              original,
              true,
              current,
            );
            slot.settled.settle(saved);
            return saved;
          } catch (error) {
            slot.settled.settle(false);
            throw error;
          }
        },
      });
      const signal = new AbortController().signal;
      async function show(
        [id, question, createdAt]: (typeof answers)[number],
        kind: 'ordinary' | 'no-proposal' | 'no-grant' = 'ordinary',
      ) {
        const completed = {
          id,
          sessionId,
          sessionVersion,
          question,
          createdAt,
        };
        await storage.startRequest(completed);
        const source = {
          answer: 'Synthetic conversation reply.',
          providerId: 'synthetic-local',
          modelId: 'synthetic-model',
          sources: [],
        };
        await storage.append({ ...completed, ...source, status: 'complete' });
        if (kind === 'no-grant') captureEnabled = false;
        const memory = owner.begin(1, question, signal, true);
        if (!memory) throw new Error('Missing live automatic note task.');
        const observers = memory.wrap(
          {
            ordinaryMemorySource: () => ({
              requestId: id,
              sessionId,
              sessionVersion,
              question,
              createdAt,
            }),
          },
          {},
        );
        await observers.onRetentionCandidate(
          {
            question,
            ...source,
            citations: [],
            status: 'complete',
            ...(kind === 'no-proposal'
              ? {}
              : { proactiveMemory: true as const }),
          },
          signal,
        );
        if (kind !== 'ordinary') {
          memory.show();
          await Promise.resolve();
          return;
        }
        const slot = hold();
        jobs.set(id, slot);
        memory.show();
        await slot.entered.wait;
      }
      await show(answers[0]);
      if (
        [
          'overlap',
          'saturation',
          'cancel-all',
          'revoke-all',
          'no-proposal',
          'no-grant',
        ].includes(mode)
      )
        await show(answers[1]);
      if (mode === 'saturation') await show(answers[2]);
      if (mode === 'no-proposal' || mode === 'no-grant')
        await show(answers[2], mode);
      if (mode === 'next' || mode === 'typed-entry')
        owner.begin(
          1,
          'I practice the guitar every Monday.',
          signal,
          mode === 'next',
        );
      if (mode === 'cancel-all') owner.discard(1);
      if (mode === 'revoke-all')
        await enrollment.replace(await enrollment.read(), null, () => true);
      if (mode === 'retired-source')
        await database.execute(
          'DELETE FROM conversation_artifacts WHERE id=?',
          [answers[0][0]],
        );
      const written =
        mode === 'next'
          ? ['first']
          : ['overlap', 'no-proposal', 'no-grant'].includes(mode)
            ? ['first', 'second']
            : mode === 'saturation'
              ? ['second', 'third']
              : [];
      // Wake the newer response first, then prove each saved note still matches
      // its own immutable source and date rather than the latest draft.
      for (const [id, slot] of [...jobs].reverse()) {
        slot.held.settle(undefined);
        expect(await slot.settled.wait).toBe(written.includes(id));
      }
      for (const [id, question, recordedAt] of answers) {
        const note = await readManualHistoryEntry(
          database,
          autoLocalConversationMemoryIdPrefix + id,
        );
        if (written.includes(id)) {
          expect(note).toMatchObject({
            details: question,
            recordedAt,
            effectiveDate: { status: 'unknown' },
          });
        } else expect(note).toBeFalsy();
      }
      owner.dispose();
    } finally {
      fixture.close();
    }
  },
);
