import Foundation

/// Retains only allowlisted root descriptors; raw URLs never enter persistent storage.
final class RootURLInbox {
    static let shared = RootURLInbox()
    static let changed = Notification.Name("OrotRootURLInboxChanged")
    private let defaults: UserDefaults
    private let lock = NSLock()
    private let key = "com.orot.mobile.root-url-inbox.v1"
    private let destinations: Set<String> = ["conversation", "overview", "records", "schedule", "settings"]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func receive(_ url: URL) {
        let raw = url.absoluteString
        let prefix = "orot://open/v1/"
        guard raw.hasPrefix(prefix) else { return }
        let destination = String(raw.dropFirst(prefix.count))
        guard destinations.contains(destination), raw == prefix + destination else { return }
        lock.lock()
        var entries = defaults.array(forKey: key) ?? []
        entries.append(["id": UUID().uuidString, "destination": destination])
        defaults.set(entries, forKey: key)
        lock.unlock()
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    /// Drop malformed heads without discarding later valid deliveries.
    func peek() -> [String: String]? {
        lock.lock()
        defer { lock.unlock() }
        var entries = defaults.array(forKey: key) ?? []
        while let first = entries.first {
            if let entry = first as? [String: String],
               let id = entry["id"], UUID(uuidString: id) != nil,
               let destination = entry["destination"], destinations.contains(destination), entry.count == 2
            {
                return entry
            }
            entries.removeFirst()
            defaults.set(entries, forKey: key)
        }
        return nil
    }

    func acknowledge(_ id: String) {
        lock.lock()
        defer { lock.unlock() }
        var entries = defaults.array(forKey: key) ?? []
        guard let first = entries.first as? [String: String], first["id"] == id else { return }
        entries.removeFirst()
        defaults.set(entries, forKey: key)
    }
}
