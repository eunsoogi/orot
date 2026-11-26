import Foundation

/// Only the shared app-owned Conversation declaration can enter this registry.
struct LiveNativeToolRegistry {
    enum Name: String {
        case canonicalHealthContext = "local-health-context"

        var instruction: String {
            switch self {
            case .canonicalHealthContext:
                "Request only the enabled local health context. Use only independently approved results."
            }
        }
    }

    let eligible: [Name]

    init?(admission: LiveResponsesAdmission) {
        guard let admitted = Name(rawValue: admission.functionName) else { return nil }
        // A name by itself cannot activate the companion path.
        guard admitted != .canonicalHealthContext ||
            (admission.canonicalConfiguration != nil && admission.dispatchTicket != nil)
        else { return nil }
        eligible = [admitted]
    }

    func allows(_ raw: String) -> Bool {
        guard let name = Name(rawValue: raw) else { return false }
        return eligible.contains(name)
    }

    /// Bind the advertised JSON to exactly the same typed allowlist used by
    /// the parser. The existing managed serializer still owns grant and schema.
    func configuration(for admission: LiveResponsesAdmission) -> [String: Any]? {
        guard let configuration = admission.configuration(),
              let responses = configuration["responses"] as? [String: Any],
              let tools = responses["tools"] as? [[String: Any]],
              tools.count == eligible.count,
              tools.compactMap({ $0["name"] as? String }) == eligible.map(\.rawValue) else { return nil }
        if eligible == [.canonicalHealthContext],
           !LiveNativeToolManifest.matchesCanonicalHealth(configuration, model: admission.backendModel)
        {
            return nil
        }
        return configuration
    }
}

/// Structural stock identity only. Settings, startup liveness, source proof,
/// and result transport remain with the original admission and ticket owners.
private enum LiveNativeToolManifest {
    static func matchesCanonicalHealth(_ configuration: [String: Any], model: String) -> Bool {
        // Reuse the exact app-owned descriptor; never attest a proposed schema
        // by round-tripping the same provider or companion value.
        var tool = LiveCanonicalContextV3Transport.stock
        tool["type"] = "function"
        tool["strict"] = false
        let expected: [String: Any] = [
            "type": "responses",
            "responses": ["model": model, "tools": [tool]],
        ]
        guard let actual = canonical(configuration), let expected = canonical(expected) else { return false }
        return actual == expected
    }

    private static func canonical(_ value: [String: Any]) -> Data? {
        guard JSONSerialization.isValidJSONObject(value) else { return nil }
        return try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
}
