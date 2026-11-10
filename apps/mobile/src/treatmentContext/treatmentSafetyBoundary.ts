import type { EvidenceReference } from '@orot/agent-runtime';
import type { SafetyPolicyAction } from '@orot/domain';
import { containsDefinitiveClinicalClaim } from '../diseaseHypotheses/clinicalClaimGuard';
import type { TreatmentExplanationRequest } from './interfaces';
import { verifyTreatmentClaim } from './safety';
import type { TreatmentClaim, TreatmentClaimVerifier } from './safety';

export type TreatmentSafetyResult =
  | { readonly status: 'validated'; readonly claims: readonly TreatmentClaim[] }
  | {
      readonly status: 'withheld';
      readonly reason: 'malformed' | 'unsafe' | 'unsupported' | 'cancelled';
    }
  | {
      readonly status: 'urgent';
      readonly actions: readonly SafetyPolicyAction[];
    }
  | {
      readonly status: 'policy';
      readonly actions: readonly SafetyPolicyAction[];
    };

// This rejection layer is deliberately conservative and is not a semantic verifier.
const prohibitedTreatment =
  /(?:\b(?:stop|start|increase|decrease|reduce|double|halve|switch|change|take|prescribe)\b.{0,50}\b(?:medication|medicine|drug|dose|dosage|pills?|tablets?|mg)\b|\b(?:treatment|medicine|drug|therapy)\b.{0,40}\b(?:will|guaranteed to|can definitely)\s+cure\b|(?:약|약물|복용|처방|용량|치료).{0,30}(?:중단|시작|증량|감량|늘리|줄이|바꾸|끊|완치))/iu;

function parseClaims(value: unknown): TreatmentClaim[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    Object.keys(envelope).some(key => key !== 'claims') ||
    !Array.isArray(envelope.claims) ||
    !envelope.claims.length ||
    envelope.claims.length > 24
  )
    return null;
  const claims: TreatmentClaim[] = [];
  for (const entry of envelope.claims) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return null;
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).some(key => key !== 'text' && key !== 'citations') ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.length > 1000 ||
      !Array.isArray(item.citations) ||
      !item.citations.length ||
      item.citations.length > 24 ||
      item.citations.some(
        ref => !ref || typeof ref !== 'object' || Array.isArray(ref),
      )
    )
      return null;
    // Snapshot producer-owned references before the asynchronous checks.
    try {
      claims.push({
        text: item.text,
        citations: JSON.parse(
          JSON.stringify(item.citations),
        ) as EvidenceReference[],
      });
    } catch {
      return null;
    }
  }
  return claims;
}

/** The caller must buffer the entire generated envelope and never project its prefixes. */
export async function evaluateTreatmentOutput(
  output: unknown,
  request: TreatmentExplanationRequest,
  verifier: TreatmentClaimVerifier | undefined,
  signal: AbortSignal,
  policyActions: readonly SafetyPolicyAction[],
): Promise<TreatmentSafetyResult> {
  const urgent = policyActions.filter(
    action =>
      action === 'seek_immediate_emergency_help' ||
      action === 'seek_immediate_emergency_help_if_warning_signs_are_present',
  );
  // Preserve the engine's actions; a non-urgent result is not evidence of safety.
  if (urgent.length) return { status: 'urgent', actions: [...policyActions] };
  if (policyActions.length)
    return { status: 'policy', actions: [...policyActions] };
  if (signal.aborted) return { status: 'withheld', reason: 'cancelled' };
  const claims = parseClaims(output);
  if (!claims) return { status: 'withheld', reason: 'malformed' };
  if (
    claims.some(
      claim =>
        prohibitedTreatment.test(claim.text) ||
        containsDefinitiveClinicalClaim(claim.text),
    )
  )
    return { status: 'withheld', reason: 'unsafe' };
  for (const claim of claims) {
    if (!(await verifyTreatmentClaim(claim, request, verifier, signal)))
      return {
        status: 'withheld',
        reason: signal.aborted ? 'cancelled' : 'unsupported',
      };
  }
  try {
    const fresh = await request.revalidateEvidence(
      claims.flatMap(claim => claim.citations),
      signal,
    );
    if (!fresh || signal.aborted)
      return {
        status: 'withheld',
        reason: signal.aborted ? 'cancelled' : 'unsupported',
      };
  } catch {
    return {
      status: 'withheld',
      reason: signal.aborted ? 'cancelled' : 'unsupported',
    };
  }
  return { status: 'validated', claims };
}
