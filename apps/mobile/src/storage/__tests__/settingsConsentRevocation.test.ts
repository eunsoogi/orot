import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createSettingsConsentStorage,
  settingsConsentSlots,
  type SettingsConsentSlot,
} from '../settingsConsentStorage';
import { settingsConsentRepository } from '../settingsConsentRepository';
import { settingsConsentAuthority } from '../settingsConsentAuthority';
import {
  inferenceConsentReceipts,
  resetInferenceConsentReceipts,
} from '../inferenceConsentStorage';
import {
  createConsentAuthority,
  type ConsentAuthorityState,
} from '../../agent/execution/consentAuthority';
import {
  canReuseConsent,
  finishConsentReset,
} from '../../agent/execution/consentRevision';

jest.mock('../settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
jest.mock('../settingsConsentAuthority', () => ({
  settingsConsentAuthority: jest.fn(),
}));

afterEach(() => {
  finishConsentReset();
  jest.restoreAllMocks();
});

async function fixture() {
  const connection = openSqliteTestDatabase(':memory:');
  const grants = createSettingsConsentStorage(connection.database);
  let sequence = 0;
  const states = new Map<string, ConsentAuthorityState>();
  let failWrite = false;
  const create = (slot: SettingsConsentSlot) =>
    createConsentAuthority(
      {
        read: async () => states.get(slot) ?? null,
        write: async state => {
          if (failWrite) throw new Error('Synthetic Keychain write failure');
          states.set(slot, { ...state });
        },
      },
      () => (++sequence).toString(16).padStart(64, '0'),
    );
  const owners = new Map(
    settingsConsentSlots.map(slot => [slot, create(slot)]),
  );
  jest
    .mocked(settingsConsentAuthority)
    .mockImplementation(slot => owners.get(slot)!);
  jest.mocked(settingsConsentRepository).mockResolvedValue(grants);
  for (const [slot, owner] of owners) {
    const active = await owner.activate();
    await grants.stage(slot, active.generation, {
      version: 1,
      catalogVersion: 'model-settings-v1',
      identity: {
        providerId: 'synthetic',
        modelId: 'synthetic',
        recipient: 'Synthetic',
        authorityGeneration: active.generation,
        credentialEpoch: 'synthetic-epoch',
      },
      permissions: [
        {
          purpose: 'record_conversation',
          policyVersion: 'local-records-v1',
          dataCategories: ['conversation'],
          sourceKinds: ['personal_record'],
        },
      ],
    });
    await grants.activate(slot, active.generation, () => true);
  }
  const legacyClear = jest
    .spyOn(inferenceConsentReceipts, 'clear')
    .mockResolvedValue();
  return {
    connection,
    grants,
    create,
    owners,
    legacyClear,
    fail: () => {
      failWrite = true;
    },
  };
}

test('SQL cleanup failure cannot resurrect grants after a recreated authority owner', async () => {
  const f = await fixture();
  try {
    const current = await f.owners.get('conversation')!.current();
    const witness = f.owners.get('conversation')!.witness(current!.generation);
    const invalidated = jest.fn();
    f.owners.get('conversation')!.subscribe(invalidated);
    jest
      .spyOn(f.grants, 'clear')
      .mockRejectedValueOnce(new Error('Synthetic cleanup failure'));
    const resetting = resetInferenceConsentReceipts();
    expect(witness()).toBe(false);
    expect(invalidated).toHaveBeenCalledTimes(1);
    await expect(resetting).rejects.toThrow('Synthetic cleanup failure');
    expect(canReuseConsent()).toBe(false);
    expect(await f.grants.read('conversation')).not.toBeNull();
    for (const slot of settingsConsentSlots)
      expect(await f.create(slot).current()).toBeNull();
    expect(f.legacyClear).not.toHaveBeenCalled();
    await resetInferenceConsentReceipts();
    expect(canReuseConsent()).toBe(true);
    for (const slot of settingsConsentSlots)
      expect(await f.grants.read(slot)).toBeNull();
    expect(f.legacyClear).toHaveBeenCalledTimes(1);
  } finally {
    f.connection.close();
  }
});

test('first durable tombstone failure reports failure and blocks this process, without claiming restart revocation', async () => {
  const f = await fixture();
  try {
    f.fail();
    await expect(resetInferenceConsentReceipts()).rejects.toThrow(
      'Synthetic Keychain write failure',
    );
    expect(canReuseConsent()).toBe(false);
    // Native persistence failed: a separately recreated owner can still see the old state.
    for (const slot of settingsConsentSlots) {
      expect(await f.owners.get(slot)!.current()).toBeNull();
      expect(await f.create(slot).current()).not.toBeNull();
      expect(await f.grants.read(slot)).not.toBeNull();
    }
    expect(f.legacyClear).not.toHaveBeenCalled();
  } finally {
    f.connection.close();
  }
});

test('a synchronous owner failure still starts the other revocations and skips cleanup', async () => {
  const f = await fixture();
  try {
    const conversation = f.owners.get('conversation')!;
    const voiceResponses = f.owners.get('voice-responses')!;
    const before = await conversation.current();
    const lastBefore = await voiceResponses.current();
    const firstWitness = conversation.witness(before!.generation);
    const lastWitness = voiceResponses.witness(lastBefore!.generation);
    const cleanup = jest.spyOn(f.grants, 'clear');
    const ownerError = new Error('Synthetic authority owner failure');
    jest.mocked(settingsConsentAuthority).mockImplementation(slot => {
      if (slot === 'calendar') throw ownerError;
      return f.owners.get(slot)!;
    });
    f.fail();

    const outcome = resetInferenceConsentReceipts().catch(
      (error: unknown) => error,
    );
    expect(firstWitness()).toBe(false);
    expect(lastWitness()).toBe(false);
    expect(await outcome).toBe(ownerError);
    expect(canReuseConsent()).toBe(false);
    expect(await conversation.current()).toBeNull();
    expect(await voiceResponses.current()).toBeNull();
    expect(await f.grants.read('voice-responses')).not.toBeNull();
    expect(cleanup).not.toHaveBeenCalled();
    expect(f.legacyClear).not.toHaveBeenCalled();
  } finally {
    f.connection.close();
  }
});
