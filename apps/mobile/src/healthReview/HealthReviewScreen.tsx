import { useEffect } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { healthReviewStyles as styles } from './styles';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { healthReviewText as copy } from '../i18n/healthReview';
import { useHealthReviewSession } from './HealthReviewSession';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { SafetyForm } from './SafetyForm';
import { ReviewResult } from './ReviewResult';

/** Keeps review actions explicit while stable panels reflow around measured content space. */
export function HealthReviewScreen({
  onSource,
  onProvider,
}: {
  onSource: () => void;
  onProvider: () => void;
}) {
  const { controller, state, consent, setCitation } = useHealthReviewSession();
  const inset = useNavigationContentInset();
  useEffect(() => {
    controller.refresh();
  }, [controller]);
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    // The retained app session owns this operation, so provider/source navigation is safe.
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const remove = (sourceId: string) =>
    Alert.alert(copy.remove, copy.removeDetail, [
      { text: '취소', style: 'cancel' },
      {
        text: copy.remove,
        style: 'destructive',
        onPress: () => {
          controller.delete(sourceId);
        },
      },
    ]);
  return (
    <ScrollView
      testID="health-review-screen"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      contentContainerStyle={[styles.container, inset]}
    >
      {/* Keep route copy in the measured primary lane during reflow. */}
      <AdaptiveColumns
        testID="health-review-layout"
        primary={
          <View style={styles.panel}>
            <View style={styles.heading} testID="health-review-heading">
              <Text accessibilityRole="header">{copy.title}</Text>
              <Text>{copy.scope}</Text>
              <Text>{copy.privacy}</Text>
            </View>
            <ReviewResult
              state={state}
              onSource={reference => {
                if (!state.invocation) return;
                setCitation({
                  reference,
                  readSource: state.invocation.readSource,
                });
                onSource();
              }}
            />
            {state.error ? (
              <Text accessibilityRole="alert" testID="health-review-error">
                {state.error === 'input' ? copy.inputError : copy.storageError}
              </Text>
            ) : null}
          </View>
        }
        secondary={
          <View style={styles.panel}>
            <AppButton
              title={copy.provider}
              testID="health-review-provider"
              onPress={onProvider}
            />
            <TextInput
              accessibilityLabel={copy.name}
              placeholder={copy.name}
              value={state.name}
              onChangeText={controller.setName}
              editable={!state.busy}
              testID="health-review-name"
            />
            <SafetyForm
              draft={state.draft}
              onChange={controller.setDraft}
              disabled={state.busy}
            />
            <View style={styles.actions}>
              {state.result?.status === 'needs_clarification' ? (
                <AppButton
                  title={copy.continue}
                  disabled={state.busy}
                  testID="health-review-continue"
                  onPress={() => {
                    controller.run(consent, true);
                  }}
                />
              ) : null}
              <AppButton
                title={copy.fresh}
                disabled={state.busy}
                testID="health-review-start"
                onPress={() => {
                  controller.run(consent);
                }}
              />
              {state.busy ? (
                <AppButton
                  title={copy.cancel}
                  testID="health-review-cancel"
                  onPress={controller.cancel}
                />
              ) : null}
            </View>
            <View style={styles.requests}>
              <Text accessibilityRole="header">{copy.requests}</Text>
              {state.requests.map(({ source, pending }) => (
                <View key={source.id} style={styles.request}>
                  <AppButton
                    title={`${source.title}: ${pending ? copy.pending : copy.terminal}`}
                    disabled={state.busy}
                    testID={`health-review-request-${source.id}`}
                    onPress={() => controller.select(source.id)}
                  />
                  <AppButton
                    title={copy.remove}
                    disabled={state.busy}
                    accessibilityLabel={`${source.title}: ${copy.remove}`}
                    testID={`health-review-delete-${source.id}`}
                    onPress={() => remove(source.id)}
                  />
                </View>
              ))}
            </View>
          </View>
        }
      />
    </ScrollView>
  );
}
