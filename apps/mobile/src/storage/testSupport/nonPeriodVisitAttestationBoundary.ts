import type { SqlDatabase } from '@orot/storage';
import { readHistoricalSavedMemory } from '../readHistoricalSavedMemory';

/** Check a changed parent with identical display text, then exercise an actual
 * identity mutation and undo across committed statements on the same memory ID. */
export async function verifyReviewedMemoryRevisions(
  db: SqlDatabase,
  memoryId: string,
  questionId: string,
) {
  const receipt = () =>
    db.execute(
      'SELECT revision FROM memory_non_period_visit_attestation WHERE memory_id=?',
      [memoryId],
    );
  const replaceMemory = (raw: string) =>
    db.execute('UPDATE agent_memory_records SET record_json=? WHERE id=?', [
      raw,
      memoryId,
    ]);
  const question = (
    await db.execute('SELECT payload_json FROM visit_questions WHERE id=?', [
      questionId,
    ])
  ).rows[0]?.payload_json;
  if (typeof question !== 'string')
    throw new Error('Expected the saved question.');
  const replaceQuestion = (raw: string) =>
    db.execute('UPDATE visit_questions SET payload_json=? WHERE id=?', [
      raw,
      questionId,
    ]);
  await replaceQuestion(
    JSON.stringify({
      ...JSON.parse(question),
      rationale: '변경된 합성 검토 이유.',
    }),
  );
  expect((await receipt()).rows).toHaveLength(1);
  expect(await readHistoricalSavedMemory(memoryId)).toBeNull();
  await replaceQuestion(question);
  expect(await readHistoricalSavedMemory(memoryId)).not.toBeNull();

  const memory = (
    await db.execute(
      'SELECT record_json FROM agent_memory_records WHERE id=?',
      [memoryId],
    )
  ).rows[0]?.record_json;
  if (typeof memory !== 'string')
    throw new Error('Expected the retained memory.');
  await replaceMemory(memory);
  expect((await receipt()).rows).toHaveLength(1);
  const record = JSON.parse(memory);
  await replaceMemory(
    JSON.stringify({ ...record, createdAt: record.createdAt + 1 }),
  );
  expect((await receipt()).rows).toHaveLength(0);
  await replaceMemory(memory);
  expect((await receipt()).rows).toHaveLength(0);
  expect(await readHistoricalSavedMemory(memoryId)).toBeNull();
}
