import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Settings, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import {
  LiveVoiceCatalogSelect,
  liveVoiceSelectBoxInset,
} from './LiveVoiceCatalogSelect';
import {
  catalogVoiceLanguage,
  liveVoiceCatalog,
  voicesForLanguage,
  type Preferences,
  type LiveVoice,
  type LiveVoiceLanguage,
} from './liveVoicePreferences';
import type { LiveVoicePreferenceStore } from './liveVoicePreferenceStore';

function voiceLabel(voice: LiveVoice) {
  if (voice === 'default') return '기본값 (Marin)';
  if (voice === 'noeul') return '노을 · 한국어';
  if (voice === 'quartz') return 'Quartz · 영어(호주)';
  return voice[0]!.toUpperCase() + voice.slice(1);
}
const languages = liveVoiceCatalog.map(([id, label]) => [id, label] as const);

function systemVoiceLanguage() {
  try {
    const preferred = Settings.get('AppleLanguages');
    return catalogVoiceLanguage(
      Array.isArray(preferred) ? preferred[0] : undefined,
    );
  } catch {
    // Missing preferred-language settings are unresolved, not a region/formatting language.
    return undefined;
  }
}

export interface LiveVoicePreferencesDraft {
  readonly owner: string;
  readonly preferences: Preferences;
  readonly dirty: boolean;
}

/** Only stages preferences for the owner of the existing sidebar Save action. */
export function LiveVoicePreferencesPanel({
  store,
  ready,
  authorityRevision,
  onDraftChange,
  busy = false,
  saveRevision = 0,
  systemLanguage = systemVoiceLanguage(),
}: {
  readonly store: LiveVoicePreferenceStore;
  readonly ready: boolean;
  readonly authorityRevision: number;
  readonly onDraftChange?: (draft: LiveVoicePreferencesDraft | null) => void;
  readonly busy?: boolean;
  readonly saveRevision?: number;
  readonly systemLanguage?: LiveVoiceLanguage | null;
}) {
  const [loaded, setLoaded] =
    useState<Awaited<ReturnType<typeof store.load>>>();
  const [draft, setDraft] = useState<Preferences>();
  const [manualGroup, setManualGroup] = useState(false);
  const [open, setOpen] = useState<'language' | 'voice'>();
  const [motionAllowed, setMotionAllowed] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let active = true,
      observed = false;
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      reduced => {
        observed = true;
        if (active) {
          if (reduced) {
            opacity.stopAnimation();
            opacity.setValue(1);
          }
          setMotionAllowed(!reduced);
        }
      },
    );
    AccessibilityInfo.isReduceMotionEnabled().then(
      reduced => {
        if (active && !observed) setMotionAllowed(!reduced);
      },
      () => undefined,
    );
    return () => {
      active = false;
      opacity.stopAnimation();
      sub.remove();
    };
  }, [opacity]);
  const current = useRef<{
    store: LiveVoicePreferenceStore;
    revision: number;
    save: number;
  }>(undefined);
  const notify = useRef(onDraftChange);
  notify.current = onDraftChange;
  useEffect(() => {
    let active = ready;
    current.current = {
      store,
      revision: authorityRevision,
      save: saveRevision,
    };
    setLoaded(undefined);
    setDraft(undefined);
    setManualGroup(false);
    setOpen(undefined);
    opacity.setValue(1);
    if (ready)
      store.load().then(
        value => {
          if (!active) return;
          setLoaded(value);
          if (value.kind === 'ready') setDraft(value.preferences);
        },
        () => {
          if (active) setLoaded({ kind: 'unavailable' });
        },
      );
    return () => {
      active = false;
      notify.current?.(null);
    };
  }, [ready, store, authorityRevision, saveRevision, opacity]);
  const currentLoad =
    ready &&
    current.current?.store === store &&
    current.current.revision === authorityRevision &&
    current.current.save === saveRevision
      ? loaded
      : undefined;
  const storedGroup = draft?.language === 'auto' ? undefined : draft?.language;
  const inferredGroup = liveVoiceCatalog.find(([, , ids]) =>
    (ids as readonly LiveVoice[]).some(id => id === draft?.voice),
  )?.[0];
  // A stored group wins; only group-less legacy records need inferred metadata.
  const language = manualGroup
    ? storedGroup
    : (storedGroup ?? inferredGroup ?? systemLanguage ?? undefined);
  const visibleVoices = language ? voicesForLanguage(language) : [];
  const compatible =
    !!draft && (!language || visibleVoices.includes(draft.voice));
  useEffect(() => {
    if (currentLoad?.kind !== 'ready' || !draft) return;
    if (!compatible) {
      notify.current?.(null);
      return;
    }
    notify.current?.({
      owner: currentLoad.owner,
      preferences: draft,
      dirty:
        draft.language !== currentLoad.preferences.language ||
        draft.voice !== currentLoad.preferences.voice,
    });
  }, [currentLoad, draft, compatible]);
  if (!ready) return null;
  if (!currentLoad)
    return (
      <Text accessibilityRole="status">음성 설정을 불러오는 중이에요.</Text>
    );
  if (currentLoad.kind !== 'ready' || !draft)
    return (
      <Text accessibilityRole="alert">
        저장된 음성 설정을 사용할 수 없어요.
      </Text>
    );

  const selectLanguage = (value: LiveVoiceLanguage) => {
    if (!language && motionAllowed) {
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
    setManualGroup(true);
    setDraft({ ...draft, language: value });
    setOpen(undefined);
  };
  return (
    <View
      style={{
        gap: 8,
        paddingHorizontal: liveVoiceSelectBoxInset,
        paddingBottom: 8,
      }}
      testID="live-voice-preferences"
    >
      <LiveVoiceCatalogSelect
        label="목소리 언어"
        testID="live-voice-language"
        options={languages}
        value={language}
        expanded={open === 'language'}
        busy={busy}
        onToggle={() => setOpen(open === 'language' ? undefined : 'language')}
        onSelect={selectLanguage}
      />
      {language ? (
        <Animated.View style={{ opacity }}>
          <LiveVoiceCatalogSelect
            label="목소리"
            testID="live-voice-voice"
            options={visibleVoices.map(id => [id, voiceLabel(id)] as const)}
            value={compatible ? draft.voice : undefined}
            expanded={open === 'voice'}
            busy={busy}
            onToggle={() => setOpen(open === 'voice' ? undefined : 'voice')}
            onSelect={(voice: LiveVoice) => {
              setDraft({ ...draft, language, voice });
              setOpen(undefined);
            }}
          />
          {!compatible ? (
            <Text>저장된 목소리: {voiceLabel(draft.voice)}</Text>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}
