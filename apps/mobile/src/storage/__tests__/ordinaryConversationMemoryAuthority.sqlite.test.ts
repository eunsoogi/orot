import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createOrdinaryConversationMemoryOwner } from '../ordinaryConversationMemoryAuthority';
import { readOrdinaryConversationMemoryEnrollment } from '../ordinaryConversationMemoryEnrollment';

const live = () => true;

function deviceOwner() {
  let persisted: ConsentAuthorityState | null = null;
  let generation = 0;
  let beforeWrite: (value: ConsentAuthorityState) => Promise<void> = async () =>
    undefined;
  return {
    open() {
      return createConsentAuthority(
        {
          read: async () => persisted,
          write: async value => {
            await beforeWrite(value);
            persisted = value;
          },
        },
        () => (++generation).toString(16).padStart(64, '0'),
      );
    },
    onWrite(hook: typeof beforeWrite) {
      beforeWrite = hook;
    },
  };
}

test('enrollment is off by default and an encrypted receipt alone cannot reactivate it', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  const oldDevice = deviceOwner();
  try {
    const owner = createOrdinaryConversationMemoryOwner(
      sqlite.database,
      oldDevice.open(),
    );
    await expect(owner.capture()).resolves.toBeUndefined();
    expect(await owner.enable(live)).toBe(true);
    const captured = (await owner.capture())!;
    expect(captured.isCurrent()).toBe(true);
    expect(captured.database).toBe(sqlite.database);

    // Rediscover exactly the same local authority on a new app process.
    const sameDevice = createOrdinaryConversationMemoryOwner(
      sqlite.database,
      oldDevice.open(),
    );
    await expect(sameDevice.capture()).resolves.toMatchObject({
      deviceEpoch: captured.deviceEpoch,
      generation: captured.generation,
    });
    // A separate device has no read access to the old protected owner.
    const newDevice = createOrdinaryConversationMemoryOwner(
      sqlite.database,
      deviceOwner().open(),
    );
    await expect(newDevice.capture()).resolves.toBeUndefined();
  } finally {
    sqlite.close();
  }
});

test('a revoke fences the previous witness synchronously and wins over an enable awaiting durable activation', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  const device = deviceOwner();
  const owner = createOrdinaryConversationMemoryOwner(
    sqlite.database,
    device.open(),
  );
  let release!: () => void;
  let holdEntered!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const entered = new Promise<void>(resolve => {
    holdEntered = resolve;
  });
  try {
    expect(await owner.enable(live)).toBe(true);
    const captured = (await owner.capture())!;
    device.onWrite(async state => {
      if (state.status !== 'active') return;
      holdEntered();
      await held;
    });

    const enable = owner.enable(live);
    await Promise.race([entered, enable]);
    expect(captured.isCurrent()).toBe(false);
    const revoke = owner.revoke();
    expect(captured.isCurrent()).toBe(false);
    release();
    await expect(enable).resolves.toBe(false);
    await expect(revoke).resolves.toBe(true);
    expect(
      await readOrdinaryConversationMemoryEnrollment(sqlite.database),
    ).toMatchObject({
      enabled: false,
      deviceEpoch: null,
    });
    const reopened = createOrdinaryConversationMemoryOwner(
      sqlite.database,
      device.open(),
    );
    await expect(reopened.capture()).resolves.toBeUndefined();
  } finally {
    release();
    sqlite.close();
  }
});

test('a failed durable activation leaves an inert SQL receipt on reopen', async () => {
  const sqlite = openSqliteTestDatabase(':memory:');
  const device = deviceOwner();
  try {
    const owner = createOrdinaryConversationMemoryOwner(
      sqlite.database,
      device.open(),
    );
    device.onWrite(async state => {
      if (state.status === 'active')
        throw new Error('injected durable activation failure');
    });
    await expect(owner.enable(live)).rejects.toThrow(
      'durable activation failure',
    );
    expect(
      await readOrdinaryConversationMemoryEnrollment(sqlite.database),
    ).toMatchObject({
      enabled: true,
    });
    const reopened = createOrdinaryConversationMemoryOwner(
      sqlite.database,
      device.open(),
    );
    await expect(reopened.capture()).resolves.toBeUndefined();
  } finally {
    sqlite.close();
  }
});
