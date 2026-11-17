import Foundation

/// Binds processing observations to one response on this request-local stream.
/// A queued response, transport headers and a local socket are not processing receipts.
struct ResponsesStartObservation {
    private var responseID: String?
    private var emitted = false

    mutating func observe(_ object: [String: Any], type: String) throws -> String? {
        let response = object["response"] as? [String: Any]
        for candidate in [object["response_id"], response?["id"]] {
            if let candidate {
                guard let id = candidate as? String, !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      id.utf8.count <= 200, responseID == nil || responseID == id
                else { throw ResponsesMalformedDiagnostics.failure(.startIdentity) }
            }
        }
        guard type == "response.created" || type == "response.in_progress" else { return nil }
        guard let response, let id = response["id"] as? String,
              let status = response["status"] as? String,
              status == "in_progress" || (type == "response.created" && status == "queued")
        else { throw ResponsesMalformedDiagnostics.failure(.startStatus) }
        if let explicit = object["response_id"] as? String, explicit != id {
            throw ResponsesMalformedDiagnostics.failure(.startIdentityMismatch)
        }
        responseID = id
        guard status == "in_progress", !emitted else { return nil }
        emitted = true
        return id
    }
}
