import type { SettingsVoicePairSelection } from '../storage/settingsVoicePairSelection';
import {
  matchVoicePairDeviceCandidate,
  referencesVoicePairSelection,
  stageVoicePairDeviceCandidate,
  type VoicePairDeviceCandidate,
} from './voicePairDeviceCandidate';
import type { StoredVoiceSettings } from './voiceSettingsTypes';

export function createVoicePairSettingsAdapter(input: {
  read: () => Promise<StoredVoiceSettings>;
  write: (value: StoredVoiceSettings) => Promise<void>;
  enqueue: (work: () => Promise<void>) => Promise<void>;
  settle: () => Promise<unknown>;
  readSelection?: () => Promise<SettingsVoicePairSelection | null>;
  readPairActive?: (
    pair: SettingsVoicePairSelection,
  ) => Promise<(() => boolean) | null>;
  currentRevision: () => number;
  beginMutation: () => () => void;
}) {
  async function selection(value: StoredVoiceSettings) {
    if (!value.pairCandidates) return null;
    if (!input.readSelection)
      throw new Error('Voice pair settings are unavailable');
    const protectedPair = await input.readSelection();
    if (!protectedPair) return null;
    return value.effectiveResponsesGeneration ===
      protectedPair.responsesGeneration ||
      value.pairCandidates.some(candidate =>
        referencesVoicePairSelection(candidate, protectedPair),
      )
      ? protectedPair
      : null;
  }
  async function readCurrent(value: StoredVoiceSettings) {
    const pair = await selection(value);
    if (!pair) return null;
    const after = await input.read();
    if (
      value.apiKey !== after.apiKey ||
      value.credentialEpoch !== after.credentialEpoch
    )
      throw new Error('Voice pair owner changed');
    if (after.effectiveResponsesGeneration !== pair.responsesGeneration)
      throw new Error('Voice pair settings are not active');
    const latest = await selection(after);
    if (latest?.responsesGeneration !== pair.responsesGeneration)
      throw new Error('Voice pair selection changed');
    return matchVoicePairDeviceCandidate(
      after.pairCandidates,
      pair,
      after.credentialEpoch,
    );
  }
  async function captureDisplayWitness(
    value: StoredVoiceSettings,
    pair: SettingsVoicePairSelection,
    revision: number,
  ): Promise<(() => boolean) | null> {
    if (!(await readCurrent(value))) return null;
    const authorized = await input.readPairActive?.(pair);
    if (!authorized?.()) return null;
    const final = await readCurrent(value);
    if (
      final?.pair.voiceGeneration !== pair.voiceGeneration ||
      final.pair.responsesGeneration !== pair.responsesGeneration
    )
      return null;
    return () => input.currentRevision() === revision && authorized();
  }
  return {
    /** A paired config stays the selected route, but it is not active after
     * a held final write lost its scope or account owner. */
    async readDisplayed() {
      const revision = input.currentRevision();
      const value = await input.read();
      const pair = await selection(value);
      if (!pair)
        return {
          ...value,
          pairAwaitingActivation: false,
          pairPresentationCurrent: null,
        };
      const witness = await captureDisplayWitness(value, pair, revision).catch(
        () => null,
      );
      return {
        ...value,
        mode: 'openai-api' as const,
        model: pair.speechModel,
        pairAwaitingActivation: witness?.() !== true,
        pairPresentationCurrent: witness,
      };
    },
    async captureVoicePairPublication(
      pair: SettingsVoicePairSelection,
      revision: number,
    ): Promise<(() => boolean) | null> {
      await input.settle();
      return captureDisplayWitness(await input.read(), pair, revision);
    },
    async readEffective() {
      const value = await input.read();
      const pair = await readCurrent(value);
      return pair
        ? {
            ...value,
            mode: 'openai-api' as const,
            model: pair.pair.speechModel,
          }
        : value;
    },
    /** Stable raw legacy owner; never treat an interrupted pair as legacy. */
    async legacyVoiceRollbackEpoch() {
      await input.settle();
      const value = await input.read();
      if (
        value.mode !== 'openai-api' ||
        value.model !== 'gpt-live-1.1' ||
        !value.apiKey ||
        value.effectiveResponsesGeneration ||
        (await selection(value))
      )
        return null;
      const after = await input.read();
      return value.credentialEpoch &&
        after.credentialEpoch === value.credentialEpoch &&
        after.apiKey === value.apiKey &&
        after.mode === value.mode &&
        after.model === value.model &&
        !after.effectiveResponsesGeneration &&
        !(await selection(after))
        ? value.credentialEpoch
        : null;
    },
    async loadCommittedVoicePair() {
      await input.settle();
      return readCurrent(await input.read());
    },
    /** Publish native activation only after the exact protected row was committed. */
    async activateVoicePair(
      pair: SettingsVoicePairSelection,
      revision: number,
      current: () => boolean,
    ) {
      const fresh = () => current() && revision === input.currentRevision();
      await input.enqueue(async () => {
        const value = await input.read();
        const committed = await selection(value);
        if (
          !fresh() ||
          committed?.voiceGeneration !== pair.voiceGeneration ||
          committed?.responsesGeneration !== pair.responsesGeneration ||
          !matchVoicePairDeviceCandidate(
            value.pairCandidates,
            committed,
            value.credentialEpoch,
          )
        )
          throw new Error('Voice pair commit is unavailable');
        await input.write({
          ...value,
          effectiveResponsesGeneration: pair.responsesGeneration,
        });
        if (!fresh()) throw new Error('Voice pair owner changed');
      });
    },
    /** Both reviewed targets remain invisible to the app until its commit receipt. */
    async stageVoicePair(
      candidate: VoicePairDeviceCandidate,
      revision: number,
      current: () => boolean,
    ) {
      const finishMutation = input.beginMutation();
      const fresh = () => current() && revision === input.currentRevision();
      try {
        await input.enqueue(async () => {
          if (!fresh() || !input.readSelection)
            throw new Error('Voice pair owner changed');
          const value = await input.read();
          if (!value.credentialEpoch || !value.apiKey)
            throw new Error('Voice pair credential unavailable');
          const previous = await selection(value);
          if (!fresh()) throw new Error('Voice pair owner changed');
          await input.write({
            ...value,
            pairCandidates: stageVoicePairDeviceCandidate(
              value.pairCandidates,
              previous,
              candidate,
              value.credentialEpoch,
            ),
          });
          if (!fresh()) throw new Error('Voice pair owner changed');
        });
      } finally {
        finishMutation();
      }
    },
  };
}
