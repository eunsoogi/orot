import { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { healthReviewStyles as styles } from './styles';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { healthReviewText as copy } from '../i18n/healthReview';
import { useHealthReviewSession } from './HealthReviewSession';
import { AiProviderSelectorRow } from '../aiFeatures/integration/AiProviderSelectorRow';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import { SafetyForm } from './SafetyForm';
import { ReviewResult } from './ReviewResult';

/** Keeps the title, inputs, safety guidance and actions in one continuous page. */
export function HealthReviewScreen({
  onSource,
  onProvider,
}: {
  onSource: () => void;
  onProvider: () => void;
}) {
  const { controller, state, consent, setCitation } = useHealthReviewSession();
  const inset = useNavigationContentInset();
  const hasDock = useNavigationRouteActions([
    ...(state.busy
      ? [
          {
            id: 'cancel-health-review',
            label: copy.cancel,
            accessibilityLabel: copy.cancel,
            testID: 'health-review-cancel',
            systemImageName: 'xmark',
            onPress: controller.cancel,
          },
        ]
      : []),
    ...(state.result?.status === 'needs_clarification'
      ? [
          {
            id: 'continue-health-review',
            label: copy.continue,
            accessibilityLabel: copy.continue,
            testID: 'health-review-continue',
            systemImageName: 'arrow.right',
            disabled: state.busy,
            onPress: () => controller.run(consent, true),
          },
        ]
      : []),
    {
      id: 'start-health-review',
      label: copy.fresh,
      accessibilityLabel: copy.fresh,
      testID: 'health-review-start',
      systemImageName: 'sparkles',
      disabled: state.busy,
      busy: state.busy,
      onPress: () => controller.run(consent),
    },
  ]);
  const navigation = useContext(NavigationContext);
  const [providerRevision, setProviderRevision] = useState(0);
  useEffect(() => {
    // Retained stack scenes need a fresh saved model when provider settings closes.
    return navigation?.addListener('focus', () =>
      setProviderRevision(revision => revision + 1),
    );
  }, [navigation]);
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
      automaticallyAdjustKeyboardInsets
      style={styles.screen}
      contentContainerStyle={[styles.container, inset]}
    >
      <View style={styles.panel} testID="health-review-layout">
        <View style={styles.heading} testID="health-review-heading">
          <Text accessibilityRole="header">{copy.title}</Text>
          <AiProviderSelectorRow
            embedded
            onPress={onProvider}
            resolveSelectedAi={resolveSelectedAiProvider}
            revision={providerRevision}
          />
          <Text>{copy.scope}</Text>
          <Text>{copy.privacy}</Text>
        </View>
        <Text>{copy.name}</Text>
        <TextInput
          accessibilityLabel={copy.name}
          placeholder={copy.name}
          value={state.name}
          style={styles.input}
          onChangeText={controller.setName}
          editable={!state.busy}
          testID="health-review-name"
        />
        <SafetyForm
          draft={state.draft}
          onChange={controller.setDraft}
          disabled={state.busy}
        />
        <ReviewResult
          state={state}
          onSource={reference => {
            if (!state.invocation) return;
            setCitation({ reference, readSource: state.invocation.readSource });
            onSource();
          }}
        />
        {state.error ? (
          <Text accessibilityRole="alert" testID="health-review-error">
            {state.error === 'input' ? copy.inputError : copy.storageError}
          </Text>
        ) : null}
        {state.busy ? (
          <Text accessibilityRole="alert">{copy.progress}</Text>
        ) : null}
        {!hasDock ? (
          <View style={styles.actions}>
            {state.result?.status === 'needs_clarification' ? (
              <AppButton
                title={copy.continue}
                variant="primary"
                disabled={state.busy}
                testID="health-review-continue"
                onPress={() => {
                  controller.run(consent, true);
                }}
              />
            ) : null}
            <AppButton
              title={copy.fresh}
              variant={
                state.result?.status === 'needs_clarification'
                  ? 'secondary'
                  : 'primary'
              }
              disabled={state.busy}
              testID="health-review-start"
              onPress={() => {
                controller.run(consent);
              }}
            />
            {state.busy ? (
              <AppButton
                title={copy.cancel}
                variant="cancel"
                testID="health-review-cancel"
                onPress={controller.cancel}
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.requests}>
          <Text accessibilityRole="header">{copy.requests}</Text>
          {state.requests.map(({ source, pending }) => (
            <View key={source.id} style={styles.request}>
              {/* The action owns its source surface; the row adds spacing, not another card. */}
              <AppButton
                title={`${source.title}: ${pending ? copy.pending : copy.terminal}`}
                variant="secondary"
                disabled={state.busy}
                testID={`health-review-request-${source.id}`}
                onPress={() => controller.select(source.id)}
              />
              <AppButton
                title={copy.remove}
                variant="destructive"
                disabled={state.busy}
                accessibilityLabel={`${source.title}: ${copy.remove}`}
                testID={`health-review-delete-${source.id}`}
                onPress={() => remove(source.id)}
              />
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
