import { Button, Text, View } from 'react-native';
import { t } from '../i18n';
import type { RecordingStatus } from './recordingTypes';
import { recordingControlStyles } from './RecordingControls.styles';

interface RecordingControlsProbeProps {
  busy: boolean;
  status: RecordingStatus;
  syntheticProbeReady: boolean;
  onPrepareSyntheticProbe: () => void;
  onPrepareSyntheticStartFailure: (
    point: 'beforeFileURL' | 'afterFileCreated',
  ) => void;
  onSendInterruption: (phase: 'began' | 'ended') => void;
  probeError: string;
}

// Keep simulator-only actions apart from the consent and recording controls.
export default function RecordingControlsProbe({
  busy,
  status,
  syntheticProbeReady,
  onPrepareSyntheticProbe,
  onPrepareSyntheticStartFailure,
  onSendInterruption,
  probeError,
}: RecordingControlsProbeProps) {
  return (
    <View
      style={recordingControlStyles.probe}
      testID="recording-synthetic-probe"
    >
      <Button
        disabled={
          busy ||
          status === 'recording' ||
          status === 'paused' ||
          status === 'interrupted'
        }
        onPress={onPrepareSyntheticProbe}
        testID="recording-probe-synthetic"
        title={t('recording.probe.synthetic')}
      />
      {status === 'completed' ? (
        <>
          <Button
            onPress={() => onPrepareSyntheticStartFailure('beforeFileURL')}
            testID="recording-probe-fail-before-file-url"
            title={t('recording.probe.failBeforeFile')}
          />
          <Button
            onPress={() => onPrepareSyntheticStartFailure('afterFileCreated')}
            testID="recording-probe-fail-after-file-created"
            title={t('recording.probe.failAfterFile')}
          />
        </>
      ) : null}
      {syntheticProbeReady &&
      (status === 'recording' || status === 'interrupted') ? (
        <>
          {status === 'recording' ? (
            <Button
              onPress={() => onSendInterruption('began')}
              testID="recording-probe-interruption-began"
              title={t('recording.probe.interruptionBegan')}
            />
          ) : null}
          {status === 'interrupted' ? (
            <Button
              onPress={() => onSendInterruption('ended')}
              testID="recording-probe-interruption-ended"
              title={t('recording.probe.interruptionEnded')}
            />
          ) : null}
        </>
      ) : null}
      {probeError ? <Text accessibilityRole="alert">{probeError}</Text> : null}
    </View>
  );
}
