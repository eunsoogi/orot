import Foundation

struct RecordingFileSecurity {
  private static let directoryName = "Recordings"

  static func directory() throws -> URL {
    guard let supportDirectory = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first else {
      throw RecordingFileSecurityError.directoryUnavailable
    }

    let url = supportDirectory.appendingPathComponent(directoryName, isDirectory: true)
    try FileManager.default.createDirectory(
      at: url,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete]
    )
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
    try markExcludedFromBackup(url)
    try verify(url)
    return url
  }

  static func fileURL(id: String, extension fileExtension: String) throws -> URL {
    guard UUID(uuidString: id) != nil else { throw RecordingFileSecurityError.invalidIdentifier }
    return try directory().appendingPathComponent("\(id).\(fileExtension)")
  }

  static func protect(_ url: URL) throws -> (protection: String, excludedFromBackup: Bool) {
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
    try markExcludedFromBackup(url)
    try verify(url)
    return ("complete", true)
  }

  private static func markExcludedFromBackup(_ url: URL) throws {
    var mutableURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutableURL.setResourceValues(values)
  }

  private static func verify(_ url: URL) throws {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard (attributes[.protectionKey] as? FileProtectionType) == .complete else {
      throw RecordingFileSecurityError.protectionNotApplied
    }
    let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
    guard values.isExcludedFromBackup == true else {
      throw RecordingFileSecurityError.backupExclusionNotApplied
    }
  }
}

private enum RecordingFileSecurityError: Error {
  case directoryUnavailable
  case invalidIdentifier
  case protectionNotApplied
  case backupExclusionNotApplied
}
