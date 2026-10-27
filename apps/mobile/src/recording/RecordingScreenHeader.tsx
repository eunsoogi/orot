import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ComposerGlassBackground } from '../ragConversation/ComposerGlassBackground';
import { t } from '../i18n';
import { recordingControlStyles as styles } from './RecordingControls.styles';
import type { RecordingStatus } from './recordingTypes';

/** Keeps the screen title and saved-recording action above the adaptive panels. */
export default function RecordingScreenHeader({
  controlsBusy,
  onOpenSavedRecordings,
  sourceRetryPending,
  stateReady,
  status,
}: {
  readonly controlsBusy: boolean;
  readonly onOpenSavedRecordings?: () => void;
  readonly sourceRetryPending: boolean;
  readonly stateReady: boolean;
  readonly status: RecordingStatus;
}) {
  return (
    <View style={styles.headingRow}>
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="recording-title"
      >
        {t('recording.title')}
      </Text>
      {onOpenSavedRecordings ? (
        <Pressable
          accessibilityLabel={t('recording.library.title')}
          accessibilityRole="button"
          disabled={
            controlsBusy ||
            (status !== 'idle' && status !== 'completed') ||
            sourceRetryPending ||
            !stateReady
          }
          onPress={onOpenSavedRecordings}
          style={styles.history}
          testID="recording-open-saved"
        >
          <ComposerGlassBackground />
          <AppSymbol
            name="clock.arrow.circlepath"
            color={appColors.primaryText}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
