import { createDirectPhotoSettingsAuthorization } from './conversationDirectPhotoAuthorization';
import {
  canReuseConsent,
  consentRevision,
} from '../agent/execution/consentRevision';
import { NativeModules } from 'react-native';
import { isBoundedInlineJPEG } from '@orot/provider-openai';
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
    if (
      !value ||
      typeof value !== 'object' ||
      !('jpegBase64' in value) ||
      typeof value.jpegBase64 !== 'string' ||
      !isBoundedInlineJPEG(value.jpegBase64)
    )
      throw new Error('Invalid picker image.');
    return value.jpegBase64;
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
