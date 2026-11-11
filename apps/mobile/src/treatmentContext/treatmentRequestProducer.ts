import type { SafetyPolicyAction } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import type { TreatmentEvidenceRequest } from './interfaces';
import { createTreatmentClaimVerifier } from './treatmentClaimVerifier';
import { explainTreatmentEducation } from './treatmentEducation';
import type { TreatmentEducationSelection } from './treatmentEducation';
import { validateTreatmentArtifact } from './treatmentSafetyArtifact';
import { evaluateTreatmentOutput } from './treatmentSafetyBoundary';
import type { TreatmentSafetyResult } from './treatmentSafetyBoundary';
import { createTreatmentSafetyService } from './treatmentSafetyService';
import { presentTreatment } from './treatmentPresentation';
import type { TreatmentPresentation } from './treatmentPresentation';

export type TreatmentRequestAction =
  | {
      readonly kind: 'request';
      readonly selection: TreatmentEducationSelection;
    }
  | {
      readonly kind: 'follow_up';
      readonly artifactId: string;
      readonly expectedArtifactRevision?: string;
      readonly sessionId?: string;
      readonly sessionVersion?: number;
      readonly selection: TreatmentEducationSelection;
    }
  | {
      readonly kind: 'reopen';
      readonly artifactId: string;
      readonly expectedArtifactRevision?: string;
      readonly sessionId?: string;
      readonly sessionVersion?: number;
    };

export interface TreatmentRetention {
  readonly id: string;
  readonly sessionId: string;
  readonly createdAt: string;
  readonly question: string;
  readonly expectedSessionVersion: number;
}

/** Only explicit local actions reach the closed verifier; this port cannot call a provider. */
export async function produceTreatmentRequest(
  database: SqlDatabase,
  action: TreatmentRequestAction,
  request: TreatmentEvidenceRequest,
  signal: AbortSignal,
  actions: readonly SafetyPolicyAction[],
  retention?: TreatmentRetention,
  presentation?: TreatmentPresentation,
): Promise<TreatmentSafetyResult> {
  const verifier = createTreatmentClaimVerifier(database);
  const store = createConversationArtifactStorage(database);
  const safety = createTreatmentSafetyService(database);
  if (signal.aborted || actions.length)
    return evaluateTreatmentOutput(null, request, verifier, signal, actions);
  try {
    // Freeze caller-owned data before any asynchronous validation or storage work.
    const chosen = JSON.parse(JSON.stringify(action)) as TreatmentRequestAction;
    const saved =
      retention &&
      (JSON.parse(JSON.stringify(retention)) as TreatmentRetention);
    let bound = {
      ...request,
      context: JSON.parse(JSON.stringify(request.context)),
      sources: JSON.parse(JSON.stringify(request.sources)),
    } as TreatmentEvidenceRequest;
    let original: Awaited<ReturnType<typeof store.read>> = null;
    const read = async (id: string) =>
      chosen.kind !== 'request' &&
      chosen.sessionId &&
      chosen.sessionVersion !== undefined
        ? ((
            await store.readSessionMany(
              chosen.sessionId,
              chosen.sessionVersion,
              [id],
            )
          )[0] ?? null)
        : store.read(id);
    const present = (
      result: TreatmentSafetyResult,
      artifactId?: string,
      expectedRevision?: string,
    ) =>
      presentTreatment({
        database,
        bound,
        result,
        presentation,
        signal,
        read,
        artifactId,
        expectedRevision,
      });
    if (chosen.kind === 'follow_up' || chosen.kind === 'reopen') {
      original = await read(chosen.artifactId);
      if (signal.aborted) return { status: 'withheld', reason: 'cancelled' };
      if (
        !original?.treatmentContext ||
        (chosen.expectedArtifactRevision !== undefined &&
          fingerprint(original) !== chosen.expectedArtifactRevision) ||
        (chosen.sessionId && chosen.sessionId !== original.sessionId) ||
        (saved && saved.sessionId !== original.sessionId)
      )
        return { status: 'withheld', reason: 'unsupported' };
      const prior = await validateTreatmentArtifact(
        original,
        bound,
        verifier,
        signal,
        actions,
      );
      if (prior.status !== 'validated') return prior;
      bound = {
        ...bound,
        context: original.treatmentContext,
        sources: original.sources,
      };
      if (chosen.kind === 'reopen') {
        if (saved) return { status: 'withheld', reason: 'malformed' };
        const current = await read(original.id);
        if (signal.aborted) return { status: 'withheld', reason: 'cancelled' };
        if (!current || stableJson(current) !== stableJson(original))
          return { status: 'withheld', reason: 'unsupported' };
        return present(
          await validateTreatmentArtifact(
            current,
            bound,
            verifier,
            signal,
            actions,
          ),
          current.id,
          fingerprint(current),
        );
      }
    } else if (chosen.kind !== 'request') {
      return { status: 'withheld', reason: 'malformed' };
    }
    const selection = chosen.selection;
    if (
      !selection ||
      ![
        'general_options',
        'hypertension_overview',
        'benefits_risks',
        'discuss_options',
        'condition',
        'record_question',
        'source_question',
      ].includes(selection.kind)
    )
      return { status: 'withheld', reason: 'malformed' };
    const result = await explainTreatmentEducation(
      database,
      bound,
      chosen.selection,
      signal,
      actions,
    );
    if (result.status !== 'validated') return result;
    if (original) {
      // Re-read the same artifact after validation so deletion, hiding, or source drift withholds the follow-up.
      const current = await read(original.id);
      if (signal.aborted) return { status: 'withheld', reason: 'cancelled' };
      if (!current || stableJson(current) !== stableJson(original))
        return { status: 'withheld', reason: 'unsupported' };
      const prior = await validateTreatmentArtifact(
        current,
        bound,
        verifier,
        signal,
        actions,
      );
      if (prior.status !== 'validated') return prior;
    }
    if (signal.aborted) return { status: 'withheld', reason: 'cancelled' };
    if (!saved)
      return present(
        result,
        original?.id,
        original ? fingerprint(original) : undefined,
      );
    // One verified claim per turn preserves the existing turn-level citation binding.
    const claim = result.claims[0];
    if (!claim || result.claims.length !== 1)
      return { status: 'withheld', reason: 'unsupported' };
    const parentRevision = original && fingerprint(original);
    // Bind the prior answer as a dependency so deletion also wins inside the save transaction.
    const sources =
      original && parentRevision
        ? [
            ...bound.sources,
            {
              kind: 'generated_conversation' as const,
              id: original.id,
              revision: parentRevision,
              reference: {
                sourceKind: 'generated_artifact' as const,
                sourceId: original.id,
                sourceRevision: parentRevision,
                evidenceId: original.id,
                evidenceRevision: parentRevision,
                effectiveTime: null,
                reviewState: 'unreviewed' as const,
                locator: {
                  kind: 'generated_artifact',
                  type: 'conversation_turn',
                },
              },
            },
          ]
        : bound.sources;
    return present(
      await safety.save(
        {
          id: saved.id,
          sessionId: saved.sessionId,
          createdAt: saved.createdAt,
          providerId: 'local',
          modelId: 'app-owned',
          status: 'complete',
          question: saved.question,
          answer: claim.text,
          citations: claim.citations,
          sources,
          treatmentContext: bound.context,
        },
        bound,
        signal,
        actions,
        saved.expectedSessionVersion,
      ),
      saved.id,
    );
  } catch {
    return {
      status: 'withheld',
      reason: signal.aborted ? 'cancelled' : 'unsupported',
    };
  }
}
