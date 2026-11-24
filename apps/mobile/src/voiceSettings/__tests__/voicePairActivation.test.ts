import type { SettingsVoicePairSelection } from '../../storage/settingsVoicePairSelection';
import { createVoicePairSettingsAdapter } from '../createVoicePairSettingsAdapter';
import type { StoredVoiceSettings } from '../voiceSettingsTypes';

function fixture() {
  const pair: SettingsVoicePairSelection = Object.freeze({
    version: 1,
    speechModel: 'gpt-live-1.1',
    backendModel: 'gpt-6-luna',
    credentialEpoch: 'a'.repeat(64),
    voiceGeneration: 'b'.repeat(64),
    responsesGeneration: 'c'.repeat(64),
  });
  let selected: SettingsVoicePairSelection | null = null;
  let revision = 5;
  let authoritiesActive = true;
  let stillMounted = true;
  let readAfterAuthority: Promise<void> | undefined;
  let didReachRead: (() => void) | undefined;
  let authorizationRead = false;
  let endAfterActiveWrite = false;
  let record: StoredVoiceSettings = {
    apiKey: 'synthetic test key',
    credentialEpoch: pair.credentialEpoch,
    model: 'apple-system-speech',
    mode: 'local',
  };
  const adapter = createVoicePairSettingsAdapter({
    read: async () => {
      if (authorizationRead && readAfterAuthority) {
        const held = readAfterAuthority;
        readAfterAuthority = undefined;
        didReachRead?.();
        await held;
      }
      return record;
    },
    write: async value => {
      record = value;
      if (value.effectiveResponsesGeneration && endAfterActiveWrite) {
        stillMounted = false;
        authoritiesActive = false;
      }
    },
    enqueue: task => task(),
    settle: async () => {},
    currentRevision: () => revision,
    beginMutation: () => () => {},
    readSelection: async () => selected,
    readPairActive: async () => {
      authorizationRead = true;
      return () => authoritiesActive;
    },
  });
  return {
    pair,
    adapter,
    current: () => revision === 5 && stillMounted,
    loseOwnerAfterFinalWrite() {
      endAfterActiveWrite = true;
    },
    holdFinalReread() {
      let finish!: () => void;
      readAfterAuthority = new Promise<void>(resolve => {
        finish = resolve;
      });
      const reached = new Promise<void>(resolve => {
        didReachRead = resolve;
      });
      return { reached, release: finish };
    },
    revokeTools() {
      authoritiesActive = false;
    },
    useApple() {
      record = {
        ...record,
        mode: 'local',
        model: 'apple-system-speech',
        pairCandidates: undefined,
        effectiveResponsesGeneration: undefined,
      };
    },
    stageReplacement: () =>
      adapter.stageVoicePair(
        {
          pair: {
            ...pair,
            voiceGeneration: 'd'.repeat(64),
            responsesGeneration: 'e'.repeat(64),
          },
          preferences: { schema: 1, language: 'ko', voice: 'noeul' },
        },
        5,
        () => true,
      ),
    publish() {
      selected = pair;
    },
    rotate() {
      revision += 1;
      record = {
        ...record,
        apiKey: 'different synthetic key',
        credentialEpoch: 'f'.repeat(64),
      };
    },
    stage: () =>
      adapter.stageVoicePair(
        { pair, preferences: { schema: 1, language: 'ko', voice: 'noeul' } },
        5,
        () => revision === 5,
      ),
  };
}

test('staging alone cannot arm native; SQL-only interruption never falls back to audio-only', async () => {
  const f = fixture();
  await f.stage();
  expect((await f.adapter.readEffective()).mode).toBe('local');
  await expect(
    f.adapter.activateVoicePair(f.pair, 5, f.current),
  ).rejects.toThrow();
  f.publish();
  expect(await f.adapter.readDisplayed()).toMatchObject({
    mode: 'openai-api',
    pairAwaitingActivation: true,
  });
  await expect(f.adapter.readEffective()).rejects.toThrow();
  await f.adapter.activateVoicePair(f.pair, 5, f.current);
  expect((await f.adapter.readEffective()).mode).toBe('openai-api');
  expect((await f.adapter.loadCommittedVoicePair())?.pair).toEqual(f.pair);
  f.rotate();
  expect(await f.adapter.readDisplayed()).toMatchObject({
    mode: 'openai-api',
    pairAwaitingActivation: true,
  });
  await expect(f.adapter.readEffective()).rejects.toThrow();
});

test('credential rotation between SQL receipt and native activation blocks both', async () => {
  const f = fixture();
  await f.stage();
  f.publish();
  f.rotate();
  await expect(
    f.adapter.activateVoicePair(f.pair, 5, f.current),
  ).rejects.toThrow();
  await expect(f.adapter.readEffective()).rejects.toThrow();
});

test('explicit Apple remains effective when a retired SQL pair outlives a failed new stage', async () => {
  const f = fixture();
  await f.stage();
  f.publish();
  await f.adapter.activateVoicePair(f.pair, 5, f.current);
  f.useApple();
  await f.stageReplacement();
  expect(await f.adapter.readDisplayed()).toMatchObject({
    mode: 'local',
    pairAwaitingActivation: false,
  });
  expect((await f.adapter.readEffective()).mode).toBe('local');
});

test('a successful final Keychain write held across ownership loss does not show an active pair', async () => {
  const f = fixture();
  await f.stage();
  f.publish();
  f.loseOwnerAfterFinalWrite();
  await expect(
    f.adapter.activateVoicePair(f.pair, 5, f.current),
  ).rejects.toThrow('owner changed');
  expect(await f.adapter.readDisplayed()).toMatchObject({
    mode: 'openai-api',
    pairAwaitingActivation: true,
  });
});

test('revocation during the final device reread cannot display the pair active', async () => {
  const f = fixture();
  await f.stage();
  f.publish();
  await f.adapter.activateVoicePair(f.pair, 5, f.current);
  const hold = f.holdFinalReread();
  const displayed = f.adapter.readDisplayed();
  await hold.reached;
  f.revokeTools();
  hold.release();
  await expect(displayed).resolves.toMatchObject({
    mode: 'openai-api',
    pairAwaitingActivation: true,
  });
});
