import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
  const readyRef = useRef(false);
  const [lastConfigured, setLastConfigured] =
    useState<AssistantAppearance | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    appearanceStore
      .load()
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
  const ready = configured;
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
        />
      ) : null}
    </Context.Provider>
  );
}
