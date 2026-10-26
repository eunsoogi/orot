import Foundation

/// Some account-backed streams omit output from the terminal snapshot. Only complete,
/// indexed item snapshots can replace it; deltas alone never establish completed output.
struct ResponsesCompletedOutput {
    private var observedItem = false
    private var consistent = true
    private var added = [Int: (id: String, type: String)]()
    private var done = [Int: [String: Any]]()

    mutating func recordAdded(_ object: [String: Any]) {
        observedItem = true
        guard let index = object["output_index"] as? Int, index >= 0,
              let item = object["item"] as? [String: Any],
              let id = item["id"] as? String, !id.isEmpty,
              let type = item["type"] as? String,
              added[index] == nil, !added.values.contains(where: { $0.id == id })
        else { consistent = false; return }
        added[index] = (id, type)
    }

    mutating func recordDone(_ object: [String: Any]) {
        observedItem = true
        guard let index = object["output_index"] as? Int,
              let item = object["item"] as? [String: Any],
              let prior = added[index], done[index] == nil,
              item["id"] as? String == prior.id, item["type"] as? String == prior.type
        else { consistent = false; return }
        done[index] = item
    }

    func resolve(_ terminal: [[String: Any]]) throws -> [[String: Any]] {
        guard terminal.isEmpty, observedItem else { return terminal }
        guard consistent, !added.isEmpty, done.count == added.count,
              Set(done.keys) == Set(0 ..< added.count)
        else { throw ChatGPTResponsesError.malformedEvent }
        return (0 ..< added.count).map { done[$0]! }
    }
}
