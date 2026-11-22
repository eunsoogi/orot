import { readManualHistoryEntry, runMigrations } from '@orot/storage';
import { createConsentAuthority } from '../../agent/execution/consentAuthority';
import { isAuthoredRoutineMemoryStatement } from '../../memory/authoredRoutineMemory';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createOrdinaryConversationMemoryOwner } from '../ordinaryConversationMemoryAuthority';
import { saveOrdinaryConversationMemoryNote } from '../ordinaryConversationMemoryNote';

const statement = 'I practice the guitar every Monday.';
const live = () => true;
const identity = {
  requestId: 'synthetic-routine-request',
  sessionId: 'synthetic-routine-session',
  sessionVersion: 0,
  question: statement,
  createdAt: '2026-11-22T00:00:00.000Z',
};
const noteId = 'conversation-local-memory:auto:' + identity.requestId;

function authority(seed: string) {
  let device: unknown = null;
  let generation = 0;
  return createConsentAuthority(
    {
      read: async () => device,
      write: async next => {
        device = next;
      },
    },
    () => seed.repeat(63) + String(++generation),
  );
}

async function fixture() {
  const sqlite = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(sqlite.database);
    const retained = createConversationArtifactStorage(sqlite.database);
    await retained.createSession(identity.sessionId, 0);
    await retained.startRequest({ ...identity, id: identity.requestId });
    await retained.append({
      id: identity.requestId,
      ...identity,
      answer: 'Synthetic answer is not a note.',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      sources: [],
      citations: [],
    });
    return {
      ...sqlite,
      retained,
      preferences: createOrdinaryConversationMemoryOwner(
        sqlite.database,
        authority('a'),
      ),
      routine: createOrdinaryConversationMemoryOwner(
        sqlite.database,
        authority('b'),
        'authored-routine',
      ),
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

test.each([
  statement,
  '매주 수요일 기타를 연습해요.',
  '저는 매일 책을 읽어요.',
])('a closed, directly authored recurring activity can be proposed: %s', text =>
  expect(isAuthoredRoutineMemoryStatement(text)).toBe(true),
);

test.each([
  'I may practice guitar every Monday.',
  'I practiced guitar yesterday.',
  'Do I practice guitar every Monday?',
  'I practice guitar every Monday. I have a medical condition.',
  'I practice guitar every Monday. My password is synthetic.',
  'I take synthetic medicines every Monday.',
  'I tell my colleague to practice guitar every Monday.',
  '매주 월요일 약을 복용해요.',
  '다음 주에 기타를 연습해요.',
  '매일 책을 읽어요. 비밀은 합성 문자열이에요.',
])(
  'does not promote a quote, transient activity, health or free payload: %s',
  text => {
    expect(isAuthoredRoutineMemoryStatement(text)).toBe(false);
  },
);

test('only its own device consent and exact completed source allow local routine details', async () => {
  const f = await fixture();
  try {
    expect(await f.preferences.enable(live)).toBe(true);
    expect(await f.routine.settingsEnrollmentIsOff()).toBe(true);
    await expect(f.routine.capture()).resolves.toBeUndefined();
    const preference = (await f.preferences.capture())!;
    expect(
      await saveOrdinaryConversationMemoryNote(
        preference,
        identity,
        true,
        live,
      ),
    ).toBe(false);

    // Even duplicating a backed-up SQL receipt deliberately does not transfer
    // independent device authority to the new enrollment.
    expect(await f.routine.enable(live)).toBe(true);
    const capture = (await f.routine.capture())!;
    expect(capture.scope).toBe('authored-routine');
    const restored = createOrdinaryConversationMemoryOwner(
      f.database,
      authority('c'),
      'authored-routine',
    );
    await expect(restored.capture()).resolves.toBeUndefined();
    expect(
      await saveOrdinaryConversationMemoryNote(capture, identity, false, live),
    ).toBe(false);
    expect(
      await saveOrdinaryConversationMemoryNote(
        capture,
        { ...identity, question: 'I read books every Monday.' },
        true,
        live,
      ),
    ).toBe(false);
    expect(
      await saveOrdinaryConversationMemoryNote(capture, identity, true, live),
    ).toBe(true);
    expect(await readManualHistoryEntry(f.database, noteId)).toMatchObject({
      details: statement,
    });
    expect(
      await saveOrdinaryConversationMemoryNote(capture, identity, true, live),
    ).toBe(false);
    await f.retained.deleteSession(identity.sessionId);
    expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
  } finally {
    f.close();
  }
});

test('revocation and re-enrollment do not reauthorize old optional work or affect reply preferences', async () => {
  const f = await fixture();
  try {
    expect(await f.preferences.enable(live)).toBe(true);
    expect(await f.routine.enable(live)).toBe(true);
    const capture = (await f.routine.capture())!;
    const revoke = f.routine.revoke();
    expect(capture.isCurrent()).toBe(false);
    expect(await revoke).toBe(true);
    expect(await f.routine.enable(live)).toBe(true);
    expect(
      await saveOrdinaryConversationMemoryNote(capture, identity, true, live),
    ).toBe(false);
    expect(await readManualHistoryEntry(f.database, noteId)).toBeNull();
    expect((await f.preferences.capture())?.isCurrent()).toBe(true);
  } finally {
    f.close();
  }
});
