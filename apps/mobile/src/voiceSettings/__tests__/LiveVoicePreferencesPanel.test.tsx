import { fireEvent, render, screen } from '@testing-library/react-native';
import { Settings } from 'react-native';
import { LiveVoicePreferencesPanel } from '../LiveVoicePreferencesPanel';
import { createLiveVoicePreferenceStore } from '../liveVoicePreferenceStore';
import {
  catalogVoiceLanguage,
  snapshotForNextCall,
} from '../liveVoicePreferences';

jest.mock('react-native/Libraries/Settings/Settings', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

test('saved language and compact filtered voice drafts are applied only by sidebar Save', async () => {
  let stored: unknown;
  const write = jest.fn(async value => {
    stored = value;
  });
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'synthetic-owner',
    read: async () => stored,
    write,
  });
  const draft = jest.fn();
  const props = {
    store,
    ready: true,
    authorityRevision: 1,
    onDraftChange: draft,
    systemLanguage: 'en' as const,
  };
  const view = await render(<LiveVoicePreferencesPanel {...props} />);
  const select = await screen.findByRole('button', { name: '목소리' });
  expect(select.props.accessibilityValue).toEqual({ text: '기본값 (Marin)' });
  expect(screen.queryByRole('radio')).toBeNull();
  expect(
    screen.getByRole('button', { name: '목소리 언어' }).props
      .accessibilityValue,
  ).toEqual({ text: '영어' });
  expect(screen.queryByText('저장', { exact: true })).toBeNull();
  await fireEvent.press(select);
  expect(screen.queryByRole('radio', { name: '노을 · 한국어' })).toBeNull();
  expect(
    screen.getByRole('radio', { name: '기본값 (Marin)' }).props
      .accessibilityState.selected,
  ).toBe(true);
  await fireEvent.press(
    screen.getByRole('radio', { name: 'Quartz · 영어(호주)' }),
  );
  expect(screen.queryByRole('radio')).toBeNull();
  expect(write).not.toHaveBeenCalled();
  const staged = draft.mock.lastCall?.[0];
  expect(staged).toEqual({
    owner: 'synthetic-owner',
    preferences: { schema: 1, language: 'en', voice: 'quartz' },
    dirty: true,
  });
  await store.save(staged.owner, staged.preferences);
  await view.rerender(
    <LiveVoicePreferencesPanel {...props} saveRevision={1} />,
  );
  const reloaded = await screen.findByRole('button', { name: '목소리' });
  expect(reloaded.props.accessibilityValue).toEqual({
    text: 'Quartz · 영어(호주)',
  });
  expect(draft.mock.lastCall?.[0]?.dirty).toBe(false);
});

test('saved catalog group does not impose a spoken language or rewrite its valid voice', async () => {
  const stored = {
    owner: 'owner',
    preferences: { schema: 1, language: 'en', voice: 'noeul' },
  };
  const write = jest.fn(async () => {});
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'owner',
    read: async () => stored,
    write,
  });
  const read = await store.load();
  if (read.kind !== 'ready')
    throw new Error('Expected legacy voice to survive');
  expect(read.preferences).toEqual({
    schema: 1,
    language: 'en',
    voice: 'noeul',
  });
  expect(snapshotForNextCall(read.preferences, true)).toEqual({
    voice: 'noeul',
  });
  await render(
    <LiveVoicePreferencesPanel
      store={store}
      ready
      authorityRevision={1}
      systemLanguage="ja"
    />,
  );
  const group = await screen.findByRole('button', { name: '목소리 언어' });
  expect(group.props.accessibilityValue).toEqual({ text: '영어' });
  expect(
    screen.getByRole('button', { name: '목소리' }).props.accessibilityValue,
  ).toEqual({ text: '선택' });
  expect(screen.getByText('저장된 목소리: 노을 · 한국어')).toBeTruthy();
  expect(catalogVoiceLanguage('ko-KR')).toBe('ko');
  expect(catalogVoiceLanguage('en_US')).toBe('en');
  expect(catalogVoiceLanguage('es-MX')).toBeUndefined();
  expect(write).not.toHaveBeenCalled();
});

test('inactive capability and changed owner clear stale drafts; sidebar busy disables selection', async () => {
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'owner',
    read: jest.fn(async () => undefined),
    write: jest.fn(async () => {}),
  });
  const draft = jest.fn();
  const view = await render(
    <LiveVoicePreferencesPanel
      store={store}
      ready={false}
      authorityRevision={1}
      onDraftChange={draft}
    />,
  );
  expect(screen.queryByText('목소리')).toBeNull();
  await view.rerender(
    <LiveVoicePreferencesPanel
      store={store}
      ready
      busy
      systemLanguage="ko"
      authorityRevision={2}
      onDraftChange={draft}
    />,
  );
  const select = await screen.findByRole('button', { name: '목소리' });
  expect(select.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(select);
  expect(screen.queryByRole('radio')).toBeNull();
  await view.rerender(
    <LiveVoicePreferencesPanel
      store={store}
      ready={false}
      authorityRevision={3}
      onDraftChange={draft}
    />,
  );
  expect(draft.mock.lastCall?.[0]).toBeNull();
});

test('unsupported locale requires a named language, then only matching voices appear', async () => {
  const write = jest.fn(async () => {});
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'owner',
    read: async () => undefined,
    write,
  });
  const updated = jest.fn();
  await render(
    <LiveVoicePreferencesPanel
      store={store}
      ready
      authorityRevision={1}
      systemLanguage={null}
      onDraftChange={updated}
    />,
  );
  const language = await screen.findByRole('button', { name: '목소리 언어' });
  expect(screen.queryByRole('button', { name: '목소리' })).toBeNull();
  await fireEvent.press(language);
  expect(screen.queryByRole('radio', { name: '자동 감지' })).toBeNull();
  await fireEvent.press(screen.getByRole('radio', { name: '한국어' }));
  await fireEvent.press(screen.getByRole('button', { name: '목소리' }));
  expect(screen.getByRole('radio', { name: '노을 · 한국어' })).toBeTruthy();
  expect(
    screen.queryByRole('radio', { name: 'Quartz · 영어(호주)' }),
  ).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test('production locale reads the first preferred Apple language, not the formatting locale', async () => {
  const settings = jest.spyOn(Settings, 'get');
  settings.mockImplementation(key =>
    key === 'AppleLanguages' ? ['ko-KR', 'en-US'] : 'en_US',
  );
  const store = createLiveVoicePreferenceStore({
    currentOwner: async () => 'synthetic-owner',
    read: async () => undefined,
    write: jest.fn(),
  });
  try {
    const first = await render(
      <LiveVoicePreferencesPanel store={store} ready authorityRevision={1} />,
    );
    expect(
      (await screen.findByTestId('live-voice-language')).props
        .accessibilityValue,
    ).toEqual({ text: '한국어' });
    expect(settings.mock.calls.every(([key]) => key === 'AppleLanguages')).toBe(
      true,
    );
    await first.unmount();
    settings.mockImplementation(key =>
      key === 'AppleLocale' ? 'ko_KR' : undefined,
    );
    await render(
      <LiveVoicePreferencesPanel store={store} ready authorityRevision={2} />,
    );
    expect(
      (await screen.findByTestId('live-voice-language')).props
        .accessibilityValue,
    ).toEqual({ text: '선택' });
    expect(screen.queryByTestId('live-voice-voice')).toBeNull();
  } finally {
    settings.mockRestore();
  }
});
