import {
  isCatalogPermission,
  isCatalogDomainPermission,
  publicSearchSettingsPermissions,
  settingsPermissionsForFeature,
} from '../settingsConsentCatalog';

test('settings catalogs keep feature and external-search recipient permissions separate', () => {
  for (const feature of ['conversation', 'calendar', 'voice'] as const) {
    const permissions = settingsPermissionsForFeature(feature);
    expect(permissions.length).toBeGreaterThan(0);
    expect(permissions.every(isCatalogPermission)).toBe(true);
    expect(permissions.some(value => value.purpose.includes('search'))).toBe(
      false,
    );
  }
  expect(isCatalogPermission(publicSearchSettingsPermissions.web)).toBe(true);
  expect(isCatalogPermission(publicSearchSettingsPermissions.medical)).toBe(
    true,
  );
  expect(
    settingsPermissionsForFeature('calendar').map(value => value.purpose),
  ).toEqual(['calendar_classification']);
});

test('known version does not admit unknown purposes, expanded data or kinds', () => {
  const example = settingsPermissionsForFeature('conversation')[0];
  expect(isCatalogPermission({ ...example, purpose: 'arbitrary-send' })).toBe(
    false,
  );
  expect(isCatalogPermission({ ...example, policyVersion: 'unknown' })).toBe(
    false,
  );
  expect(
    isCatalogPermission({ ...example, dataCategories: ['raw_photo'] }),
  ).toBe(false);
  expect(isCatalogPermission({ ...example, sourceKinds: ['secret'] })).toBe(
    false,
  );
  expect(isCatalogPermission({ ...example, dataCategories: [] })).toBe(false);
  expect(
    settingsPermissionsForFeature('voice').some(value =>
      value.dataCategories.includes('photo_ocr'),
    ),
  ).toBe(false);
});

test('callers receive copies, not mutable shared catalog arrays', () => {
  const values = settingsPermissionsForFeature('conversation');
  const next = settingsPermissionsForFeature('conversation');
  expect(values).toEqual(next);
  expect(values[0]).not.toBe(next[0]);
  expect(values[0].dataCategories).not.toBe(next[0].dataCategories);
});

test('a known permission cannot cross recipient domains or feature slots', () => {
  expect(
    isCatalogDomainPermission(
      'conversation',
      'model',
      publicSearchSettingsPermissions.web,
    ),
  ).toBe(false);
  expect(
    isCatalogDomainPermission(
      'conversation',
      'public-web',
      publicSearchSettingsPermissions.web,
    ),
  ).toBe(true);
  expect(
    isCatalogDomainPermission(
      'conversation',
      'medical-search',
      publicSearchSettingsPermissions.web,
    ),
  ).toBe(false);
  expect(
    isCatalogDomainPermission(
      'voice',
      'public-web',
      publicSearchSettingsPermissions.web,
    ),
  ).toBe(false);
});
