import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../consentAuthority';

function fixture() {
  let stored: unknown = null;
  let next = 0;
  const persistence = {
    read: jest.fn(async () => stored),
    write: jest.fn(async (value: ConsentAuthorityState) => {
      stored = { ...value };
    }),
  };
  const create = () =>
    createConsentAuthority(persistence, () =>
      (++next).toString(16).padStart(64, '0'),
    );
  return { persistence, create };
}

test('suspension and revocation remain unavailable across a new owner despite grant cleanup failure', async () => {
  const f = fixture();
  const owner = f.create();
  expect(await owner.current()).toBeNull();
  await owner.activate();
  expect(await owner.current()).not.toBeNull();
  await owner.suspend();
  expect(await f.create().current()).toBeNull();
  await owner.activate();
  await owner.revoke();
  // A subsequent SQLCipher clear may fail; the independently durable authority remains revoked.
  expect(await f.create().current()).toBeNull();
});

test('cancel restores only a proven unchanged principal and the exact suspension', async () => {
  const f = fixture();
  const owner = f.create();
  const prior = await owner.activate();
  const suspension = await owner.suspend();
  expect(await owner.restore(suspension, prior, async () => false)).toBe(false);
  expect(await owner.current()).toBeNull();
  expect(await owner.restore(suspension, prior, async () => true)).toBe(true);
  expect(await owner.current()).toEqual(prior);
  await owner.revoke();
  expect(await owner.restore(suspension, prior, async () => true)).toBe(false);
  expect(await owner.current()).toBeNull();
});

test('first durable-write failure blocks the current owner without claiming restart persistence', async () => {
  const f = fixture();
  const owner = f.create();
  const prior = await owner.activate();
  f.persistence.write.mockRejectedValueOnce(
    new Error('Synthetic keychain failure'),
  );
  await expect(owner.revoke()).rejects.toThrow('Synthetic keychain failure');
  expect(await owner.current()).toBeNull();
  // No durable write happened: a new process cannot infer an unrecorded revocation.
  expect(await f.create().current()).toEqual(prior);
  await owner.revoke();
  expect(await f.create().current()).toBeNull();
});

test('grant activation stays unavailable until exact suspended owner completes its live checks', async () => {
  const f = fixture();
  const owner = f.create();
  const suspension = await owner.suspend();
  expect(await owner.current()).toBeNull();
  expect(await owner.complete(suspension, async () => false)).toBe(false);
  expect(await f.create().current()).toBeNull();
  expect(await owner.complete(suspension, async () => true)).toBe(true);
  expect((await f.create().current())?.generation).toBe(suspension.generation);
  await owner.revoke();
  expect(await owner.complete(suspension, async () => true)).toBe(false);
  expect(await f.create().current()).toBeNull();
});

test('changed selection after active authority write returns failure and resuspends durably', async () => {
  const f = fixture();
  const owner = f.create();
  const suspension = await owner.suspend();
  let reads = 0;
  expect(await owner.complete(suspension, async () => ++reads === 1)).toBe(
    false,
  );
  expect(await f.create().current()).toBeNull();
});

test('queued revocation cannot be overwritten by an older activation finishing its native write', async () => {
  const f = fixture();
  const owner = f.create();
  const suspension = await owner.suspend();
  const original = f.persistence.write.getMockImplementation()!;
  let release!: () => void;
  let started!: () => void;
  const writing = new Promise<void>(resolve => {
    started = resolve;
  });
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  f.persistence.write.mockImplementationOnce(async state => {
    started();
    await blocked;
    await original(state);
  });
  const activation = owner.complete(suspension, async () => true);
  await writing;
  const revocation = owner.revoke();
  release();
  expect(await activation).toBe(false);
  await revocation;
  expect(await owner.current()).toBeNull();
  expect(await f.create().current()).toBeNull();
});

test('dispatch witness is invalid as soon as a revoke is queued, before persistence settles', async () => {
  const f = fixture();
  const owner = f.create();
  const active = await owner.activate();
  expect(owner.witness(active.generation)()).toBe(false);
  await owner.current();
  const witness = owner.witness(active.generation);
  expect(witness()).toBe(true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const original = f.persistence.write.getMockImplementation()!;
  f.persistence.write.mockImplementationOnce(async state => {
    await gate;
    await original(state);
  });
  const revoke = owner.revoke();
  expect(witness()).toBe(false);
  release();
  await revoke;
  expect(witness()).toBe(false);
});
