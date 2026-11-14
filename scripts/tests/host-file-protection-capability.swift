import Foundation

// Read-only host capability evidence is not proof of per-file protection.
// Emit fixed labels only: resource errors and filesystem paths can be private.
let manager = FileManager.default
let locations: [(String, URL)] = [
    ("temporary", manager.temporaryDirectory),
    ("home", manager.homeDirectoryForCurrentUser),
    ("workspace", URL(fileURLWithPath: manager.currentDirectoryPath)),
]
for (label, url) in locations {
    let values = try? (url as NSURL).resourceValues(forKeys: [.volumeSupportsFileProtectionKey])
    let supported = values?[.volumeSupportsFileProtectionKey] as? NSNumber
    let state = supported.map { $0.boolValue ? "supported" : "unsupported" } ?? "unavailable"
    print("HOST_FILE_PROTECTION_CAPABILITY location=\(label) state=\(state)")
}
