import Foundation

struct RecordingFileSecurity {
  private static let directoryName = "Recordings"

  static func directory(allowUnverifiedProtectionForSimulator: Bool = false) throws -> URL {
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
    _ = try verify(url, allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator)
    return url
  }

  static func fileURL(
    id: String,
    extension fileExtension: String,
    allowUnverifiedProtectionForSimulator: Bool = false
  ) throws -> URL {
    guard UUID(uuidString: id) != nil else { throw RecordingFileSecurityError.invalidIdentifier }
    return try directory(
      allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator
    ).appendingPathComponent("\(id).\(fileExtension)")
  }

  static func protect(
    _ url: URL,
    allowUnverifiedProtectionForSimulator: Bool = false
  ) throws -> (protection: String, excludedFromBackup: Bool) {
    try FileManager.default.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
    try markExcludedFromBackup(url)
    let protection = try verify(
      url,
      allowUnverifiedProtectionForSimulator: allowUnverifiedProtectionForSimulator
    )
    return (protection, true)
  }

  private static func markExcludedFromBackup(_ url: URL) throws {
    var mutableURL = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutableURL.setResourceValues(values)
  }

  private static func verify(
    _ url: URL,
    allowUnverifiedProtectionForSimulator: Bool
  ) throws -> String {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    let protectionApplied = (attributes[.protectionKey] as? FileProtectionType) == .complete
    let protection: String
    #if DEBUG && targetEnvironment(simulator)
    if protectionApplied {
      protection = "complete"
    } else if allowUnverifiedProtectionForSimulator {
      protection = "unverified"
    } else {
      throw RecordingFileSecurityError.protectionNotApplied
    }
    #else
    guard protectionApplied else { throw RecordingFileSecurityError.protectionNotApplied }
    protection = "complete"
    #endif

    let values = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
    guard values.isExcludedFromBackup == true else {
      throw RecordingFileSecurityError.backupExclusionNotApplied
    }
    return protection
  }
}

private enum RecordingFileSecurityError: Error {
  case directoryUnavailable
  case invalidIdentifier
  case protectionNotApplied
  case backupExclusionNotApplied
}
