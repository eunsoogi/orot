import { createManualHistoryRepository, runMigrations } from '@orot/storage';
import type { EvidenceReference } from '@orot/agent-runtime';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { treatmentSafetyKo } from '../../i18n/treatmentSafety';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import {
  hypertensionEducation,
  hypertensionEducationReferences,
} from '../hypertensionEducation';
import { generalEducation, savedEducation } from '../localTreatmentEvidence';
import { createTreatmentClaimVerifier } from '../treatmentClaimVerifier';
import type { TreatmentEvidenceRequest } from '../interfaces';
import { produceTreatmentRequest } from '../treatmentRequestProducer';
import { prepareTreatmentRetention } from '../treatmentSavedLibrary';
import type { VerifiedTreatmentSource } from '../treatmentSourceLinks';
import { createTreatmentSourceResolver } from '../../aiFeatures/integration/resolveTreatmentSource';

test('a reopened SQLite possibility resolves its exact public reference and fails closed on drift or an invalid URL', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    const { database } = db;
    await runMigrations(database);
    const signal = new AbortController().signal;
    const history = createManualHistoryRepository(database);
    const entry = await history.create({
      kind: 'diagnosis_history',
      title: 'Synthetic',
      details: 'Synthetic',
      effectiveDate: { status: 'unknown' },
    });
    const revision = fingerprint(await history.getEvidence(entry.id));
    const local: EvidenceReference = {
      sourceKind: 'personal_record',
      sourceId: entry.id,
      sourceRevision: revision,
      evidenceId: entry.id,
      evidenceRevision: revision,
      effectiveTime: null,
      reviewState: 'unknown',
      locator: { kind: 'manual_history', entryId: entry.id },
    };
    const article: EvidenceReference = {
      sourceKind: 'external_medical',
      sourceId: 'europe-pmc',
      sourceRevision: 'original',
      evidenceId: 'MED:123',
      evidenceRevision: 'original',
      effectiveTime: null,
      reviewState: 'unknown',
      locator: {
        provider: 'Europe PMC',
        title: 'Synthetic article',
        source: 'MED',
        recordId: '123',
        originalUrl: 'https://europepmc.org/article/MED/123',
      },
    };
    const store = createConversationArtifactStorage(database);
    const lease = { id: 'treatment-public-session', version: 0 };
    await store.createSession(lease.id, await store.currentGeneration());
    const resolve = createTreatmentSourceResolver({
      registry: new LocalEvidenceReferenceRegistry(),
      loadLocalData: async () => localData([]).data,
    });
    const reopen = async (reference: EvidenceReference) => {
      const request: TreatmentEvidenceRequest = {
        ...savedEducation,
        context: {
          ...generalEducation.context,
          conditions: [
            {
              status: 'ai_possibility',
              title: 'Synthetic',
              uncertainty: 'Synthetic',
              missingData: [],
              supportingEvidence: [local],
              contraryEvidence: [reference],
            },
          ],
        },
        sources: [
          {
            reference: local,
            records: [{ kind: 'manual_history', id: entry.id, revision }],
          },
          { reference, records: [] },
        ],
      };
      const saved = prepareTreatmentRetention(lease);
      expect(
        await produceTreatmentRequest(
          database,
          { kind: 'request', selection: { kind: 'condition', index: 0 } },
          request,
          signal,
          [],
          saved,
        ),
      ).toMatchObject({ status: 'validated' });
      let links: readonly VerifiedTreatmentSource[] = [];
      expect(
        await produceTreatmentRequest(
          database,
          {
            kind: 'reopen',
            artifactId: saved.id,
            sessionId: lease.id,
            sessionVersion: lease.version,
          },
          savedEducation,
          signal,
          [],
          undefined,
          {
            onVerified: current => {
              links = current;
            },
          },
        ),
      ).toMatchObject({ status: 'validated' });
      return links.find(
        link => link.source.reference.sourceKind === 'external_medical',
      )!;
    };
    const current = await reopen(article);
    expect(await resolve(current, signal)).toEqual(article);
    const older = {
      ...article,
      locator: { originalUrl: 'https://europepmc.org/article/MED/123' },
    };
    expect(await resolve(await reopen(older), signal)).toEqual(older);
    const invalid = await reopen({
      ...article,
      locator: {
        ...(article.locator as object),
        originalUrl: 'https://europepmc.org/article/MED/456',
      },
    });
    expect(await resolve(invalid, signal)).toBeNull();
    const unsafe = await reopen({
      ...older,
      locator: {
        originalUrl: 'https://europepmc.org@elsewhere.example/article/MED/123',
      },
    });
    expect(await resolve(unsafe, signal)).toBeNull();
    await history.delete(entry.id);
    expect(await resolve(current, signal)).toBeNull();
  } finally {
    db.close();
  }
});

test('the closed verifier requires the explicit public topic, exact text and every reviewed source', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const verify = createTreatmentClaimVerifier(db.database).verify;
    const signal = new AbortController().signal;
    const claim = {
      text: treatmentSafetyKo['treatmentSafety.hypertensionOverview'],
      citations: hypertensionEducationReferences,
    };
    expect(await verify(claim, hypertensionEducation, signal)).toBe(true);
    expect(
      await verify(
        { ...claim, text: claim.text + ' 변경' },
        hypertensionEducation,
        signal,
      ),
    ).toBe(false);
    expect(
      await verify(
        { ...claim, citations: claim.citations.slice(1) },
        hypertensionEducation,
        signal,
      ),
    ).toBe(false);
    expect(
      await verify(
        claim,
        {
          ...hypertensionEducation,
          context: { ...hypertensionEducation.context, publicTopic: undefined },
        },
        signal,
      ),
    ).toBe(false);
    expect(
      await verify(
        claim,
        {
          ...hypertensionEducation,
          context: {
            ...hypertensionEducation.context,
            missingContext: ['Unrelated personal context'],
          },
        },
        signal,
      ),
    ).toBe(false);
  } finally {
    db.close();
  }
});
