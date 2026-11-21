import { commitJointExistingModelConsent } from '../jointExistingModelConsent';
import {
  openJointConsentFixture as fixture,
  slots,
} from '../testSupport/jointModelConsent.fixture';
test('cancelling the review never writes, and both grants are absent before shared commit', async () => {
  const f = fixture();
  try {
    await expect(f.approve(false)).rejects.toThrow('owner changed');
    expect(f.durable.size).toBe(0);
    const during: boolean[][] = [];
    f.intercept(async (_slot, state) => {
      if (state.status === 'active')
        during.push(await Promise.all(slots.map(f.usable)));
    });
    await f.approve();
    expect(during).toEqual([
      [false, false],
      [false, false],
    ]);
    expect(await Promise.all(slots.map(f.usable))).toEqual([true, true]);
  } finally {
    f.db.close();
  }
});

test('second slot Keychain activation failure restores the unchanged earlier owners', async () => {
  const f = fixture();
  try {
    await f.approve();
    const prior = slots.map(slot => f.durable.get(slot)?.generation);
    let rejected = false;
    f.intercept(async (slot, state) => {
      if (!rejected && slot === 'calendar' && state.status === 'active') {
        rejected = true;
        throw new Error('synthetic keychain failure');
      }
    });
    await expect(f.approve()).rejects.toThrow('keychain failure');
    expect(slots.map(slot => f.durable.get(slot)?.generation)).toEqual(prior);
    expect(await Promise.all(slots.map(f.usable))).toEqual([true, true]);
  } finally {
    f.db.close();
  }
});

test('second slot database activation failure leaves neither new authority usable after recreation', async () => {
  const f = fixture();
  try {
    await f.db.database.execute('SELECT 1');
    await f.storage.read('calendar');
    await f.db.database.execute(`CREATE TRIGGER reject_calendar_grant
      BEFORE UPDATE ON settings_inference_grants
      WHEN NEW.slot = 'calendar' AND NEW.state = 'active'
      BEGIN SELECT RAISE(ABORT, 'synthetic calendar grant failure'); END`);
    await expect(f.approve()).rejects.toThrow('calendar grant failure');
    expect(await f.storage.read('calendar')).toBeNull();
    expect(await f.storage.read('conversation')).toBeNull();
    expect(await Promise.all(slots.map(f.usable))).toEqual([false, false]);
  } finally {
    f.db.close();
  }
});

test('owner drift during Keychain activation never restores the changed recipient', async () => {
  const f = fixture();
  try {
    await f.approve();
    const prior = f.durable.get('conversation')?.generation;
    f.intercept(async (slot, state) => {
      if (slot === 'calendar' && state.status === 'active')
        f.invalidate('calendar');
    });
    await expect(f.approve()).rejects.toThrow('owner changed');
    expect(f.durable.get('conversation')?.generation).toBe(prior);
    expect(await Promise.all(slots.map(f.usable))).toEqual([true, false]);
  } finally {
    f.db.close();
  }
});

test('a proposed first-time selection is written only once both slots are suspended, then compensated if a Keychain completion fails', async () => {
  const f = fixture();
  try {
    let selection: 'new' | null = null;
    f.intercept(async (slot, state) => {
      if (slot === 'calendar' && state.status === 'active')
        throw new Error('synthetic keychain failure');
    });
    await expect(
      commitJointExistingModelConsent(f.targets, f.storage, () => true, {
        async stage() {
          expect(slots.map(slot => f.durable.get(slot)?.status)).toEqual([
            'suspended',
            'suspended',
          ]);
          expect(await Promise.all(slots.map(f.usable))).toEqual([
            false,
            false,
          ]);
          selection = 'new';
          return true;
        },
        async compensate() {
          expect(selection).toBe('new');
          selection = null;
        },
      }),
    ).rejects.toThrow('keychain failure');
    expect(selection).toBeNull();
    expect(await Promise.all(slots.map(f.usable))).toEqual([false, false]);
  } finally {
    f.db.close();
  }
});
