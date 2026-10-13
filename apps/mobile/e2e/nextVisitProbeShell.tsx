import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import { AppButton } from '../src/layout/AppButton';
import { AppSymbol } from '../src/layout/AppSymbol';
import { appColors } from '../src/layout/appColors';
import { t } from '../src/i18n';
import type { NextVisitQuestionsRouteState } from '../src/nextVisitQuestions/types';

/** Fixture controls live in a separate modal; the product uses the real safe-area and Glass shell. */
export function NextVisitProbeShell({
  adapterStatus,
  canReload,
  onComplete,
  onReload,
  children,
}: {
  readonly adapterStatus: string;
  readonly canReload: boolean;
  readonly onComplete: () => void;
  readonly onReload: () => void;
  readonly children: (
    onState: (state: NextVisitQuestionsRouteState) => void,
  ) => ReactNode;
}) {
  const controller = useMemo(() => {
    const navigation = createNavigationController<'home' | 'questions'>('home');
    navigation.push('questions');
    return navigation;
  }, []);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [state, setState] = useState<NextVisitQuestionsRouteState>({
    hasUnsavedChanges: false,
    isSaving: false,
    isGenerating: false,
    revision: 0,
  });
  const onState = useCallback(
    (next: NextVisitQuestionsRouteState) => setState(next),
    [],
  );
  return (
    <NavigationRouteAdapter
      controller={controller}
      showHome
      leaveState={{
        readState: () => ({
          canLeave: !state.isSaving,
          hasUnsavedChanges: state.hasUnsavedChanges,
          hasOngoingOperation: state.isGenerating,
          isRecording: false,
          revision: state.revision,
          inputRevision: state.revision,
        }),
      }}
    >
      {actions => (
        <>
          {actions.route.name === 'questions' ? (
            children(onState)
          ) : (
            <AppButton
              title={t('probe.nextVisit.open')}
              onPress={() => actions.push('questions')}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('probe.nextVisit.tools')}
            onPress={() => setToolsOpen(true)}
            style={styles.tools}
            testID="next-visit-probe-tools"
          >
            <AppSymbol name="wrench.and.screwdriver" size={16} />
          </Pressable>
          <Modal
            visible={toolsOpen}
            animationType="none"
            onRequestClose={() => setToolsOpen(false)}
          >
            <View style={styles.modal}>
              <Text style={styles.text} testID="next-visit-probe-boundary">
                {t('probe.nextVisit.boundary')}
              </Text>
              <Text
                style={styles.text}
                testID="next-visit-probe-adapter-status"
              >
                {adapterStatus}
              </Text>
              {adapterStatus === 'synthetic-generating' ? (
                <AppButton
                  title={t('probe.nextVisit.complete')}
                  testID="next-visit-probe-complete-generation"
                  onPress={() => {
                    onComplete();
                    setToolsOpen(false);
                  }}
                />
              ) : null}
              {canReload ? (
                <AppButton
                  title={t('probe.nextVisit.reload')}
                  testID="next-visit-probe-reload-screen"
                  onPress={() => {
                    onReload();
                    setToolsOpen(false);
                  }}
                />
              ) : null}
              <AppButton
                title={t('probe.nextVisit.closeTools')}
                testID="next-visit-probe-close-tools"
                onPress={() => setToolsOpen(false)}
              />
            </View>
          </Modal>
        </>
      )}
    </NavigationRouteAdapter>
  );
}

const styles = StyleSheet.create({
  tools: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: appColors.background,
  },
  text: { color: appColors.text, fontSize: 16 },
});
