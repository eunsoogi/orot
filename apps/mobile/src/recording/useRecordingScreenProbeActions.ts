import { useState } from 'react';
import { t } from '../i18n';
import {
  isSyntheticRecordingProbeAvailable,
  prepareSyntheticRecordingProbe,
  prepareSyntheticRecordingStartFailure,
  simulateRecordingInterruption,
} from './nativeRecordingBridge';

/** Keeps simulator-only recording controls out of the saved-recording workflow. */
export function useRecordingScreenProbeActions() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  async function prepare(): Promise<void> {
    setError('');
    try {
      await prepareSyntheticRecordingProbe();
      setReady(true);
    } catch {
      setError(t('recording.errors.generic'));
    }
  }

  async function prepareStartFailure(
    point: 'beforeFileURL' | 'afterFileCreated',
  ): Promise<void> {
    setError('');
    try {
      await prepareSyntheticRecordingStartFailure(point);
      setReady(true);
    } catch {
      setError(t('recording.errors.generic'));
    }
  }

  async function sendInterruption(phase: 'began' | 'ended'): Promise<void> {
    setError('');
    try {
      await simulateRecordingInterruption(phase);
    } catch {
      setError(t('recording.errors.generic'));
    }
  }

  return {
    available: isSyntheticRecordingProbeAvailable(),
    clear: () => setReady(false),
    error,
    prepare,
    prepareStartFailure,
    ready,
    sendInterruption,
  };
}
