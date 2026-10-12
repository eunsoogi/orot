import { Button, Text } from 'react-native';

interface Props {
  readonly onPrepareResidue: () => Promise<void>;
  readonly onReadResidue: () => Promise<void>;
  readonly onArmCancellation: () => Promise<void>;
  readonly residueCount: string;
  readonly sourceStatus: string;
  readonly cancellationStatus: string;
  readonly sourceId: string | null;
}

/** Keep asynchronous bridge completion observable independently of the system share sheet. */
export function RecordingExportProbeControls(props: Props) {
  return (
    <>
      <Button
        onPress={props.onPrepareResidue}
        testID="recording-export-prepare-residue"
        title="Prepare interrupted export cleanup"
      />
      <Button
        onPress={props.onReadResidue}
        testID="recording-export-read-residue"
        title="Read export temp files"
      />
      <Button
        onPress={props.onArmCancellation}
        testID="recording-export-arm-simulated-cancel"
        title="Simulate export cancellation"
      />
      <Text testID="recording-export-residue-count">{props.residueCount}</Text>
      <Text testID="recording-export-source-status">{props.sourceStatus}</Text>
      <Text testID="recording-export-cancellation-status">
        {props.cancellationStatus}
      </Text>
      <Text testID="recording-export-source-id">
        {props.sourceId ?? 'none'}
      </Text>
    </>
  );
}
