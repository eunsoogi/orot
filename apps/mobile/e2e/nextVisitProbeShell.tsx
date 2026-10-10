import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import { AppButton } from '../src/layout/AppButton';
import { AppSymbol } from '../src/layout/AppSymbol';
import { appColors } from '../src/layout/appColors';
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
              title="질문 화면 열기"
              onPress={() => actions.push('questions')}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="합성 검증 도구 열기"
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
                합성 화면 흐름 · 실제 AI 제공자와 영구 저장소는 검증하지 않음
              </Text>
              <Text
                style={styles.text}
                testID="next-visit-probe-adapter-status"
              >
                {adapterStatus}
              </Text>
              {adapterStatus === 'synthetic-generating' ? (
                <AppButton
                  title="합성 질문 생성 완료"
                  testID="next-visit-probe-complete-generation"
                  onPress={() => {
                    onComplete();
                    setToolsOpen(false);
                  }}
                />
              ) : null}
              {canReload ? (
                <AppButton
                  title="합성 저장 목록 다시 불러오기"
                  testID="next-visit-probe-reload-screen"
                  onPress={() => {
                    onReload();
                    setToolsOpen(false);
                  }}
                />
              ) : null}
              <AppButton
                title="화면 보기"
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
