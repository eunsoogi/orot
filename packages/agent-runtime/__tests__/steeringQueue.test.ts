import { createSteeringQueue } from '../src/multiAgent/steeringQueue';

const owner = 'synthetic-request';

describe('request-owned steering queue', () => {
  it('deduplicates retries without replacing conflicting instructions or reordering', () => {
    const queue = createSteeringQueue(owner);
    expect(queue.enqueue(owner, 'first', 'Use plain words')).toBe('queued');
    expect(queue.enqueue(owner, 'first', 'Use plain words')).toBe('duplicate');
    expect(queue.enqueue(owner, 'first', 'Different request')).toBe('rejected');
    expect(queue.enqueue(owner, 'second', 'Keep it concise')).toBe('queued');
    expect(queue.prepare(owner)?.instructions.map((item) => item.id)).toEqual(['first', 'second']);
    expect(queue.snapshot().map((item) => item.sequence)).toEqual([1, 2]);
  });

  it('does not claim queued or prepared instructions were applied', () => {
    const queue = createSteeringQueue(owner);
    queue.enqueue(owner, 'first', 'Use plain words');
    expect(queue.acknowledge(owner, 1)).toBe(false);
    expect(queue.snapshot()[0].status).toBe('queued');
    queue.prepare(owner);
    expect(queue.snapshot()[0].status).toBe('prepared');
    expect(queue.acknowledge(owner, 2)).toBe(false);
    expect(queue.acknowledge(owner, 1)).toBe(true);
    expect(queue.snapshot()[0].status).toBe('applied');
    expect(queue.acknowledge(owner, 1)).toBe(false);
  });

  it('holds steering arriving during dispatch for a later boundary without replay', () => {
    const queue = createSteeringQueue(owner);
    queue.enqueue(owner, 'first', 'First instruction');
    queue.prepare(owner);
    queue.enqueue(owner, 'second', 'Second instruction');
    expect(queue.prepare(owner)).toBeUndefined();
    queue.acknowledge(owner, 1);
    expect(queue.prepare(owner)).toMatchObject({ revision: 2, instructions: [{ id: 'second' }] });
  });

  it('fences stale owners, repeated Stop and late provider receipts', () => {
    const queue = createSteeringQueue(owner);
    expect(queue.enqueue('old-owner', 'first', 'Ignore')).toBe('rejected');
    queue.enqueue(owner, 'first', 'Pending');
    expect(queue.prepare('old-owner')).toBeUndefined();
    queue.prepare(owner);
    queue.close('old-owner');
    expect(queue.snapshot()[0].status).toBe('prepared');
    queue.close(owner);
    queue.close(owner);
    expect(queue.acknowledge(owner, 1)).toBe(false);
    expect(queue.enqueue(owner, 'second', 'Late')).toBe('rejected');
    expect(queue.snapshot()[0].status).toBe('not_applied');
  });

  it('preserves applied state on completion and clears all private content on deletion', () => {
    const queue = createSteeringQueue(owner);
    queue.enqueue(owner, 'first', 'Synthetic private content');
    queue.prepare(owner);
    queue.acknowledge(owner, 1);
    queue.enqueue(owner, 'second', 'Not yet delivered');
    queue.close(owner);
    expect(queue.snapshot().map((item) => item.status)).toEqual(['applied', 'not_applied']);
    queue.clear(owner);
    expect(queue.snapshot()).toEqual([]);
    expect(queue.prepare(owner)).toBeUndefined();
  });

  it('does not allow observers to mutate queued or prepared content', () => {
    const queue = createSteeringQueue(owner);
    queue.enqueue(owner, 'first', 'Original');
    const visible = queue.snapshot();
    Object.assign(visible[0], { text: 'Mutated' });
    const batch = queue.prepare(owner)!;
    Object.assign(batch.instructions[0], { text: 'Mutated again' });
    expect(queue.snapshot()[0].text).toBe('Original');
  });

  it('preserves large instructions and queues beyond the former byte and count ceilings', () => {
    const queue = createSteeringQueue(owner);
    expect(queue.enqueue(owner, 'blank', '  ')).toBe('rejected');
    const text = '가😀'.repeat(6000);
    for (let index = 0; index < 20; index += 1)
      expect(queue.enqueue(owner, String(index), text)).toBe('queued');
    expect(queue.prepare(owner)?.instructions).toHaveLength(20);
    expect(queue.snapshot().every((item) => item.text === text)).toBe(true);
    expect(queue.enqueue('wrong-owner', 'other', text)).toBe('rejected');
  });
});
