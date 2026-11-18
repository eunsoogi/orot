// Settings service authorization has separate owner/storage tests; this fixture controls UI timing.
export const mockAuthorize = jest.fn(async () => true);
export const mockPermission = {
  authorize: mockAuthorize,
  current: () => true,
  stop: jest.fn(),
  consent: {},
};
