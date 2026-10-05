function unsupportedFileStorage() {
  throw new Error(
    'Rememori FileStorage is unavailable in the app; inject SQLCipher storage.',
  );
}

module.exports = {
  appendFile: unsupportedFileStorage,
  readFile: unsupportedFileStorage,
  rename: unsupportedFileStorage,
  writeFile: unsupportedFileStorage,
};
