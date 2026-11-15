import type { SqlDatabase } from '@orot/storage';

/** Distinct synthetic retained messages exercise the real source identity lookup. */
export async function retainedActionSources(database: SqlDatabase) {
  const sources = [
    {
      id: 'prior',
      question: '지난달 기침을 한 것 같아요.',
      answer: '확인했습니다.',
    },
    {
      id: 'earlier',
      question: '지난주 두통이 있었던 것 같아요.',
      answer: '확인했습니다.',
    },
  ] as const;
  for (const source of sources) {
    await database.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      [
        source.id,
        'session',
        '2026-11-14T00:00:00.000Z',
        JSON.stringify(source),
      ],
    );
  }
  return sources;
}

/** The final reconstructed action, not an earlier receipt, receives the denial. */
export function actionRecoveryDecision(
  mode: boolean | 'later-denied',
  count: number,
) {
  let confirmations = 0;
  return jest.fn(
    async () =>
      mode === true || (mode === 'later-denied' && ++confirmations < count),
  );
}
