import Foundation

/// The anchor and its query scope travel together in the encrypted sync checkpoint.
/// Retaining previously visible concepts lets HealthKit report their tombstones
/// after catalog shrinkage; absence alone never means deletion or revoked access.
struct MedicationDoseCursor: Codable {
    let anchor: String?
    let concepts: Set<String>

    static let prefix = "medication-dose:"

    private enum CodingKeys: String, CodingKey { case anchor, concepts }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(anchor, forKey: .anchor)
        try container.encode(concepts.sorted(), forKey: .concepts)
    }

    static func decode(_ value: String?) throws -> MedicationDoseCursor {
        guard let value else { return MedicationDoseCursor(anchor: nil, concepts: []) }
        // Old scoped anchors did not retain the query scope. Replay once rather
        // than advancing them over older doses that become visible later.
        guard value.hasPrefix(prefix) else { return MedicationDoseCursor(anchor: nil, concepts: []) }
        guard let data = Data(base64Encoded: String(value.dropFirst(prefix.count))) else {
            throw CursorError.invalid
        }
        let result = try JSONDecoder().decode(Self.self, from: data)
        guard result.concepts.allSatisfy({ !$0.isEmpty }) else { throw CursorError.invalid }
        return result
    }

    func merging(_ visible: Result<Set<String>, Error>, replay: Bool) throws -> MedicationDoseCursor {
        let current = try visible.get()
        // An added concept changes the query domain, so its earlier doses require
        // a bounded replay. Shrinking/empty catalogs retain the old query domain.
        return MedicationDoseCursor(anchor: replay || !current.isSubset(of: concepts) ? nil : anchor,
                                    concepts: concepts.union(current))
    }

    func encoded(anchor: String?) throws -> String {
        let value = MedicationDoseCursor(anchor: anchor, concepts: concepts)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let result = try Self.prefix + encoder.encode(value).base64EncodedString()
        guard result.count <= 1_000_000 else { throw CursorError.invalid }
        return result
    }

    enum CursorError: Error { case invalid }
}
