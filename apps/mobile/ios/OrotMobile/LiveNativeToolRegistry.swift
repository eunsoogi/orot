import Foundation

/// The current managed port has exactly one entitled native function. Synthetic
/// owned fixtures may use reviewed memory, but the production mailbox cannot.
struct LiveNativeToolRegistry {
    enum Name: String {
        case healthAggregate = "orot_health_context"
        case reviewedMemory = "orot_reviewed_memory"

        var instruction: String {
            switch self {
            case .healthAggregate:
                "The enabled app tool can request one bounded ordinary heart-rate average. " +
                "Use only its approved result; do not claim other record access or actions."
            case .reviewedMemory:
                "Use only the enabled app tool and its approved result; do not claim other record access or actions."
            }
        }
    }

    let eligible: [Name]

    init?(admission: LiveResponsesAdmission) {
        guard let admitted = Name(rawValue: admission.functionName) else { return nil }
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
        return configuration
    }
}
