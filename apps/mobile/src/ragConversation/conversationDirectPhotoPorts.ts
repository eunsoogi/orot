import { createDirectPhotoSettingsAuthorization } from './conversationDirectPhotoAuthorization';
import {
  canReuseConsent,
  consentRevision,
} from '../agent/execution/consentRevision';
import { NativeModules } from 'react-native';
import { captureDirectPhotoGroup } from '@orot/provider-openai';
import { resolveSelectedAiProvider } from '../aiFeatures/integration/provider';
import { providerSelectionStore } from '../providers/selection/keychainSelectionStore';
import { readChatGPTConsentCredential } from '../providers/chatGPTConsentIdentity';

interface ImagePicker {
  readonly pickConversationImage?: () => Promise<unknown>;
}
const picker = () =>
  NativeModules.MedicalDocumentImportModule as ImagePicker | undefined;

/** The dedicated system picker returns only normalized JPEG data for the selected image. */
export const conversationDirectPhotoPorts = {
  hasPicker: () => Boolean(picker()?.pickConversationImage),
  async pick() {
    const module = picker();
    if (!module?.pickConversationImage)
      throw new Error('Image picker unavailable.');
    const value = await module.pickConversationImage();
    if (value === null) return null;
    if (typeof value !== 'object' || !value || Array.isArray(value))
      throw new Error('Invalid picker image.');
    const raw = value as Record<string, unknown>;
    const keys = Object.keys(raw);
    const group = captureDirectPhotoGroup(
      keys.length === 1 && keys[0] === 'jpegBase64'
        ? [raw.jpegBase64]
        : keys.length === 1 && keys[0] === 'jpegBase64s'
          ? raw.jpegBase64s
          : undefined,
    );
    if (!group) throw new Error('Invalid picker image.');
    return group.length === 1 ? group[0]! : group;
  },
  grant: createDirectPhotoSettingsAuthorization(),
  async authorization() {
    // Current selection and credentials do not constitute a photo grant.
    // The composer also verifies the separate disclosed scope immediately before dispatch.
    const selection = providerSelectionStore.liveWitness();
    const revision = consentRevision();
    if (!selection || !canReuseConsent()) return null;
    const credential = await readChatGPTConsentCredential();
    if (!credential || !selection()) return null;
    const current = () =>
      selection() &&
      credential.isCurrent() &&
      canReuseConsent() &&
      consentRevision() === revision;
    const selected = await resolveSelectedAiProvider();
    if (!current() || selected.status !== 'ready') return null;
    return {
      selected,
      current,
      subscribe(listener: () => void) {
        const stop = providerSelectionStore.subscribeChanges(listener);
        const release = credential.subscribe(listener);
        return () => {
          stop();
          release();
        };
      },
    };
  },
};
