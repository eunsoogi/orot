import Foundation

public protocol HostIdentifierStore: Sendable {
    func loadOrCreate() -> String
}

public final class UserDefaultsHostIdentifierStore: HostIdentifierStore, @unchecked Sendable {
    private let defaults: UserDefaults
    private let key: String
    private let lock = NSLock()

    public init(
        defaults: UserDefaults = .standard,
        key: String = "com.orot.provider.openai.ext-agent-host-id",
    ) {
        self.defaults = defaults
        self.key = key
    }

    public func loadOrCreate() -> String {
        lock.lock()
        defer { lock.unlock() }

        if let existing = defaults.string(forKey: key),
           Self.isValidHostIdentifier(existing)
        {
            return existing
        }

        let identifier = "urn:uuid:\(UUID().uuidString.lowercased())"
        defaults.set(identifier, forKey: key)
        return identifier
    }

    static func isValidHostIdentifier(_ value: String) -> Bool {
        guard value.hasPrefix("urn:uuid:") else { return false }
        return UUID(uuidString: String(value.dropFirst("urn:uuid:".count))) != nil
    }
}
