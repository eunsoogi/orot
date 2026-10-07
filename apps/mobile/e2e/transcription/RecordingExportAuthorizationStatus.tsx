import { useEffect, useState } from 'react';
import { Keyboard, Text } from 'react-native';
import { verifySyntheticRecordingExportAuthorization } from '../../src/recording/syntheticRecordingExportProbeBridge';

interface Props {
  readonly recordingId: string | null;
}

// This Simulator-only view reports fixture guardrails without implying device protection evidence.
export function RecordingExportAuthorizationStatus({ recordingId }: Props) {
  const [report, setReport] = useState('pending');

  useEffect(() => {
    let isCurrent = true;
    if (!recordingId) {
      setReport('pending');
      return () => {
        isCurrent = false;
      };
    }

    setReport('pending');
    verifySyntheticRecordingExportAuthorization(recordingId)
      .then(result => {
        if (isCurrent) setReport(JSON.stringify(result));
      })
      .catch(() => {
        if (isCurrent) setReport('failed');
      });

    return () => {
      isCurrent = false;
    };
  }, [recordingId]);

  // This test-only report also gives Detox a visible target to dismiss multiline editing before scrolling.
  return (
    <Text
      accessibilityRole="button"
      onPress={Keyboard.dismiss}
      testID="recording-export-authorization-probe"
    >
      {report}
    </Text>
  );
}
