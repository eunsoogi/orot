import { Alert } from 'react-native';
import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import type {
  EvidenceItem,
  EvidenceReference,
  ExternalMedicalQueryConsentPort,
} from '@orot/agent-runtime';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';

function canonical(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  return JSON.stringify(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function referenceOnly({
  content: _content,
  ...reference
}: EvidenceItem): EvidenceReference {
  return reference;
}

/** Consent covers this exact query only, never a future turn or the model's separate payload. */
export const externalConversationConsent: ExternalMedicalQueryConsentPort = {
  authorize: request =>
    new Promise(resolve => {
      if (request.signal.aborted) {
        resolve('denied');
        return;
      }
      let settled = false;
      const finish = (approved: boolean) => {
        if (settled) return;
        settled = true;
        request.signal.removeEventListener('abort', abort);
        resolve(approved && !request.signal.aborted ? 'authorized' : 'denied');
      };
      const abort = () => finish(false);
      request.signal.addEventListener('abort', abort, { once: true });
      Alert.alert(
        '공개 의학 문헌을 찾아볼까요?',
        `아래 검색어를 Europe PMC로 전송해요. 개인 정보가 포함되어 있는지 확인해 주세요.\n\n${request.query}`,
        [
          { text: '취소', style: 'cancel', onPress: () => finish(false) },
          { text: '이 검색어로 찾기', onPress: () => finish(true) },
        ],
        { cancelable: true, onDismiss: () => finish(false) },
      );
    }),
};

/** Captures only validated adapter references for this run; invented external citations cannot validate. */
export function createExternalConversationEvidence(
  service: EuropePmcMedicalEvidenceService,
  consent = externalConversationConsent,
  options: { readonly requireAbstract?: boolean } = {},
) {
  const references = new Set<string>();
  // A metadata-only hit cannot support a medical explanation. Filter the bounded service page
  // before the adapter's result limit so another available abstract can occupy that citation slot.
  const contextService: EuropePmcMedicalEvidenceService =
    options.requireAbstract
      ? {
          async search(query, searchOptions) {
            const result = await service.search(query, searchOptions);
            if (result.status !== 'available') return result;
            const publications = result.publications.filter(
              item => typeof item.abstract === 'string' && item.abstract.trim(),
            );
            return publications.length
              ? { status: 'available', publications }
              : { status: 'empty' };
          },
        }
      : service;
  const adapter = createEuropePmcEvidenceSearchTool({
    service: contextService,
    consent,
  });
  return {
    tool: {
      ...adapter,
      async search(request: Parameters<typeof adapter.search>[0]) {
        const batch = await adapter.search(request);
        // This filtered literature sample is never a complete review. Preserve actual adapter
        // gaps and conflicts; an omitted metadata-only hit is not missing personal health data.
        const result =
          options.requireAbstract && !('status' in batch)
            ? {
                ...batch,
                coverage: batch.coverage.map(item => ({
                  ...item,
                  truncated: true,
                })),
              }
            : batch;
        if (!request.signal.aborted && !('status' in result)) {
          for (const item of result.items)
            references.add(canonical(referenceOnly(item)));
        }
        return result;
      },
    },
    validates(reference: EvidenceReference) {
      return references.has(canonical(reference));
    },
  };
}
