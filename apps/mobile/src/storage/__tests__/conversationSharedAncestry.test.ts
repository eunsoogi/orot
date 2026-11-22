import type { SqlExecutor } from '@orot/storage';
import {
  createConversationAncestryTraversal,
  createConversationSharedAncestry,
} from '../conversationSharedAncestry';

const tx: SqlExecutor = {
  execute: async () => {
    throw new Error('Structural replay does not execute SQL');
  },
};
const subject = { id: 'parent', revision: 'one' };

test('replays ordered structural size by multiplicity and refuses a cycle, depth limit, or visit overflow', () => {
  const token = createConversationSharedAncestry(tx, () => true);
  const first = createConversationAncestryTraversal(tx, token);
  first.enter(subject.id);
  for (const id of ['child', 'child', 'leaf']) {
    first.enter(id);
    first.leave(id);
  }
  first.leave(subject.id, subject);

  const cycle = createConversationAncestryTraversal(tx, token);
  cycle.enter('child');
  expect(cycle.reuse(subject)).toBe(false);

  const deep = createConversationAncestryTraversal(tx, token);
  for (let step = 0; step < 14; step++) deep.enter(`deep-${step}`);
  expect(deep.reuse(subject)).toBe(true);
  deep.enter('near-limit');
  expect(deep.reuse(subject)).toBe(false);

  const many = createConversationAncestryTraversal(tx, token);
  many.enter('root');
  for (let repeat = 0; repeat < 31; repeat++)
    expect(many.reuse(subject)).toBe(true);
  expect(many.reuse(subject)).toBe(false);
  for (let step = 0; step < 3; step++) {
    many.enter(`extra-${step}`);
    many.leave(`extra-${step}`);
  }
  expect(() => many.enter('outside')).toThrow(
    'Conversation ancestry is cyclic or too large.',
  );
});

test('never issues structural authority on a matching ID with different revision, copied token, or owner change', () => {
  let active = true;
  const token = createConversationSharedAncestry(tx, () => active);
  const first = createConversationAncestryTraversal(tx, token);
  first.enter(subject.id);
  first.leave(subject.id, subject);
  expect(first.reuse({ ...subject, revision: 'changed' })).toBe(false);
  expect(
    createConversationAncestryTraversal(tx, { ...token }).reuse(subject),
  ).toBe(false);
  expect(
    createConversationAncestryTraversal({ ...tx }, token).reuse(subject),
  ).toBe(false);
  active = false;
  expect(first.reuse(subject)).toBe(false);
});

test('oversized descendant IDs fall back without retaining a subtree', () => {
  const token = createConversationSharedAncestry(tx, () => true);
  const first = createConversationAncestryTraversal(tx, token);
  const oversized = 'x'.repeat(201);
  first.enter(subject.id);
  first.enter(oversized);
  first.leave(oversized);
  first.leave(subject.id, subject);
  const next = createConversationAncestryTraversal(tx, token);
  next.enter('root');
  expect(next.reuse(subject)).toBe(false);
});
