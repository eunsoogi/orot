import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, NativeModules, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import SafeAreaLayout from '../layout/SafeAreaLayout';
import { appearanceStore } from './appearanceStore';
import type { AssistantAppearance } from './appearance';
import { AppearanceEditor } from './AppearanceEditor';
import { t } from '../i18n';

type State =
  | { status: 'loading' | 'error' | 'unconfigured' }
  | { status: 'configured'; value: AssistantAppearance };
type ContextValue = {
  value: AssistantAppearance;
  ready: boolean;
  canEnter: () => boolean;
  edit: () => void;
};
const Context = createContext<ContextValue | null>(null);
export const useAssistantAppearance = () => useContext(Context);

function syntheticPhotoAppearanceFixture(): AssistantAppearance | null {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const settings =
    settingsManager?.settings ?? settingsManager?.getConstants?.().settings;
  if (
    settings?.OROT_TEST_PROFILE !== 'core' ||
    settings.OROT_E2E_PROBE !== 'medical-document-import' ||
    settings.OROT_TEST_ASSISTANT_APPEARANCE !== 'synthetic'
  ) {
    return null;
  }
  return { avatar: 'neutral', name: null };
}

export function withAssistantAppearance<P extends object>(
  Component: ComponentType<P>,
) {
  return function AppearanceEntry(props: P) {
    return (
      <AssistantAppearanceProvider>
        <Component {...props} />
      </AssistantAppearanceProvider>
    );
  };
}

/** No normal route or notification drain mounts until the encrypted preference is resolved. */
export function AssistantAppearanceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const readyRef = useRef(false);
  const [lastConfigured, setLastConfigured] =
    useState<AssistantAppearance | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    const loadAppearance = async () => {
      const saved = await appearanceStore.load();
      if (saved) return saved;
      const fixture = syntheticPhotoAppearanceFixture();
      if (!fixture) return null;

      // Keep the entry gate on its real encrypted-store path for this opted-in synthetic journey.
      await appearanceStore.save(fixture);
      return appearanceStore.load();
    };
    loadAppearance()
      .then(value => {
        if (current) {
          readyRef.current = value != null;
          setLastConfigured(value);
          setState(
            value
              ? { status: 'configured', value }
              : { status: 'unconfigured' },
          );
        }
      })
      .catch(() => {
        if (current) setState({ status: 'error' });
      });
    return () => {
      current = false;
    };
  }, [revision]);
  if (state.status === 'loading')
    return (
      <SafeAreaLayout>
        <ActivityIndicator
          accessibilityLabel={t('assistantAppearance.loading')}
        />
      </SafeAreaLayout>
    );
  if (state.status === 'error')
    return (
      <SafeAreaLayout>
        <View>
          <AppText accessibilityRole="alert">
            {t('assistantAppearance.loadError')}
          </AppText>
          <AppButton
            title={t('assistantAppearance.retry')}
            onPress={() => {
              setState({ status: 'loading' });
              setRevision(value => value + 1);
            }}
          />
        </View>
      </SafeAreaLayout>
    );
  const configured = state.status === 'configured';
  const ready = configured && !clearing;
  const visibleValue =
    state.status === 'configured' ? state.value : lastConfigured;
  return (
    <Context.Provider
      value={
        visibleValue
          ? {
              value: visibleValue,
              ready,
              canEnter: () => readyRef.current,
              edit: () => setEditing(true),
            }
          : null
      }
    >
      {visibleValue ? children : null}
      {!configured ? (
        <AppearanceEditor
          onSave={value => {
            readyRef.current = true;
            setLastConfigured(value);
            setState({ status: 'configured', value });
          }}
        />
      ) : null}
      {state.status === 'configured' && editing ? (
        <AppearanceEditor
          initial={state.value}
          onCancel={() => setEditing(false)}
          onSave={value => {
            setLastConfigured(value);
            setState({ status: 'configured', value });
            setEditing(false);
          }}
          onClear={() => {
            setClearing(false);
            setEditing(false);
            setState({ status: 'unconfigured' });
          }}
          onClearStart={() => {
            readyRef.current = false;
            setClearing(true);
          }}
          onClearFailed={() => {
            readyRef.current = true;
            setClearing(false);
          }}
        />
      ) : null}
    </Context.Provider>
  );
}
