import { openSavedWebSettingsFixture } from '../testSupport/SavedWebSearchRoundTrip.fixture';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  createChatGPTPlanProvider,
  type ChatGPTPlanNativeEvent,
} from '@orot/provider-openai';
import { createDirectPhotoSettingsAuthorization } from '../../../ragConversation/conversationDirectPhotoAuthorization';
import { createConversationPhotoImageSend } from '../../../aiFeatures/integration/sendConversationPhotoImage';
import { syntheticDirectJPEG } from '../../../aiFeatures/integration/testSupport/directPhotoSendFixture';
import { publicEvidenceFixture } from '../../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';
import {
  directPhotoPermission,
  legacyDirectPhotoConsentScope,
} from '../../../agent/execution/directPhotoConsentScope';
import { resolveSettingsConsentOwner } from '../../../agent/execution/settingsConsentOwner';
import { saveModelSettingsConsent } from '../../../agent/execution/saveModelSettingsConsent';
import { calendarModelStore } from '../../../calendarModelSettings/calendarModelStore';
import { providerSelectionStore } from '../keychainSelectionStore';

test.each(['Settings', 'joint Calendar', 'non-Settings picker'] as const)(
  'only a reviewed Settings action can grant image access: %s',
  async route => {
    const feature = route === 'non-Settings picker';
    const joint = route === 'joint Calendar';
    let receive: ((event: ChatGPTPlanNativeEvent) => void) | undefined;
    const startPhotoResponse = jest.fn(async (requestId: string) => {
      receive?.({
        requestId,
        type: 'response_started',
        responseId: 'one-response',
      });
      receive?.({ requestId, type: 'text_delta', text: '합성 답변' });
      receive?.({ requestId, type: 'completed', text: '합성 답변' });
    });
    const modelId = 'gpt-6.2-sol';
    const provider = createChatGPTPlanProvider({
      issuedClientID: 'synthetic-account',
      model: {
        slug: modelId,
        displayName: 'Synthetic image model',
        supportsDirectPhoto: true,
      },
      bridge: {
        startPhotoResponse,
        startResponse: async () => {},
        listModels: async () => [],
        cancelResponse: () => {},
        subscribe(next) {
          receive = next;
          return () => {
            receive = undefined;
          };
        },
      },
    });
    const prior = publicEvidenceFixture().selected;
    const selected = {
      ...prior,
      provider,
      option: { ...prior.option, provider, modelId },
      modelId,
      selection: { providerId: provider.id, modelId },
    };
    const fixture = openSavedWebSettingsFixture(selected);
    const { sql, selection, recipient, reloaded, selectionView, commit } =
      fixture;
    const controller = new AbortController();
    const signal = controller.signal;
    const authorize = createDirectPhotoSettingsAuthorization({
      resolveOwner: resolveSettingsConsentOwner,
      readGrant: reloaded.read,
    });
    const current = { ...selected, recipient };
    try {
      if (joint) await calendarModelStore.save(fixture.calendarChoice);
      await saveModelSettingsConsent({
        slot: 'conversation',
        selection,
        recipient,
        remote: true,
        search: { web: false, medical: !feature },
        store: providerSelectionStore,
        signal,
        isCurrent: () => true,
      });
      const before = await reloaded.read('conversation', 'model');
      expect(before?.permissions).not.toContainEqual(directPhotoPermission);
      await expect(authorize(current, signal)).resolves.toBeNull();
      const view = await render(selectionView(feature));
      try {
        const press = (id: string) => fireEvent.press(view.getByTestId(id));
        await press('provider-option-0');
        await waitFor(() =>
          expect(view.getByTestId('provider-selection-confirm')).toBeEnabled(),
        );
        await press('provider-selection-confirm');
        if (feature) {
          await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
          expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
          expect(
            (await reloaded.read('conversation', 'model'))?.permissions,
          ).not.toContainEqual(directPhotoPermission);
          expect(
            await reloaded.read('conversation', 'medical-search'),
          ).toBeNull();
          await expect(authorize(current, signal)).resolves.toBeNull();
          expect(startPhotoResponse).not.toHaveBeenCalled();
          return;
        }
        const details = await view.findByTestId('inference-disclosure-scope');
        expect(details).toHaveTextContent(
          /선택한 사진 최대 세 장과 입력한 질문만[\s\S]+다른 대화나 건강 기록을 자동으로 첨부하지 않습니다/,
        );
        expect(details).toHaveTextContent(/Europe PMC/);
        expect(details).toHaveTextContent(/사진 원본은 저장하지 않습니다/);
        expect(details).toHaveTextContent(/iOS 기기 백업에 포함될 수 있습니다/);
        expect(details).toHaveTextContent(
          /사진에서 읽은 정보가 포함될 수 있는 답변/,
        );
        await press('inference-disclosure-cancel');
        expect(await reloaded.read('conversation', 'model')).toEqual(before);
        await expect(authorize(current, signal)).resolves.toBeNull();
        await press('provider-selection-confirm');
        await fireEvent.press(
          await view.findByTestId('inference-disclosure-allow'),
        );
        await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
        expect(
          (await reloaded.read('conversation', 'model'))?.permissions,
        ).toContainEqual(directPhotoPermission);
        expect(
          (await reloaded.read('conversation', 'medical-search'))?.identity
            .recipient,
        ).toBe('Europe PMC');
        expect(Boolean(await reloaded.read('calendar'))).toBe(joint);
        if (!joint) {
          const approved = await reloaded.read('conversation', 'model');
          await view.rerender(selectionView());
          await press('provider-option-0');
          await waitFor(() =>
            expect(
              view.getByTestId('provider-selection-confirm'),
            ).toBeEnabled(),
          );
          await press('provider-selection-confirm');
          await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
          expect(view.queryByTestId('inference-disclosure-sheet')).toBeNull();
          expect(await reloaded.read('conversation', 'model')).toEqual(
            approved,
          );
        }
        const legacyOnly = createDirectPhotoSettingsAuthorization({
          resolveOwner: resolveSettingsConsentOwner,
          async readGrant(slot, domain) {
            const grant = await reloaded.read(slot, domain);
            return (
              grant && {
                ...grant,
                permissions: grant.permissions.map(permission =>
                  permission.purpose === directPhotoPermission.purpose
                    ? {
                        ...permission,
                        policyVersion:
                          legacyDirectPhotoConsentScope.policyVersion,
                      }
                    : permission,
                ),
              }
            );
          },
        });
        expect((await legacyOnly(current, signal))?.current()).toBe(true);
        await expect(legacyOnly(current, signal, 2)).resolves.toBeNull();
        expect((await authorize(current, signal, 2))?.current()).toBe(true);
        const proof = await authorize(current, signal);
        expect(proof?.current()).toBe(true);
        await expect(
          authorize(
            { ...current, recipient: 'wrong synthetic recipient' },
            signal,
          ),
        ).resolves.toBeNull();
        if (!proof) throw new Error('Expected an image grant before dispatch');
        const send = () =>
          createConversationPhotoImageSend({
            selected: current,
            jpegBase64: syntheticDirectJPEG,
            prompt: '',
            signal,
            isCurrent: proof.current,
            subscribeInvalidation: proof.subscribe,
            confirm: async () => proof.current(),
          })();
        expect(await send()).toEqual({ status: 'answer', text: '합성 답변' });
        expect(startPhotoResponse).toHaveBeenCalledTimes(1);
        const revoked = jest.fn();
        const stop = proof.subscribe(revoked);
        await act(async () => {
          await fixture.authority.revoke();
        });
        expect(revoked).toHaveBeenCalled();
        expect(proof?.current()).toBe(false);
        await expect(authorize(current, signal)).resolves.toBeNull();
        stop?.();
        expect((await send()).status).toBe('cancelled');
        expect(startPhotoResponse).toHaveBeenCalledTimes(1);
      } finally {
        await view.unmount();
      }
    } finally {
      sql.close();
    }
  },
);
