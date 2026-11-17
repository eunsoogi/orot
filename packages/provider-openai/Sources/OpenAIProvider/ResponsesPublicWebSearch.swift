import CoreFoundation
import Foundation

public struct ChatGPTWebCitation: Equatable, Sendable {
    public let url: String
    public let title: String
}

/// These are citations on a model-generated explanation, never fetched original passages.
public struct ChatGPTPublicWebSearchResult: Equatable, Sendable {
    public let callCount: Int
    public let citations: [ChatGPTWebCitation]
}

/// Hosted search can perform as many steps as the provider needs. Validate identities and
/// public-only output without turning completed calls or citations into a local execution quota.
struct ResponsesPublicWebSearch {
    let enabled: Bool
    private var observedIDs = Set<String>()

    init(enabled: Bool) {
        self.enabled = enabled
    }

    static func validQuery(_ query: String) -> Bool {
        !query.isEmpty && query == query.trimmingCharacters(in: .whitespacesAndNewlines) &&
            query.count <= 240 && query.utf8.count <= 1024 &&
            !query.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }

    mutating func recordAdded(_ item: [String: Any]?) throws {
        guard let item else { return }
        if item["type"] as? String == "web_search_call" {
            guard enabled else { throw ChatGPTResponsesError.unsupportedCapability("hosted tools") }
            guard let id = item["id"] as? String, !id.isEmpty,
                  observedIDs.insert(id).inserted
            else { throw ResponsesMalformedDiagnostics.failure(.publicCallIdentityOrLimit) }
        } else if enabled, item["type"] as? String == "function_call" {
            throw ResponsesMalformedDiagnostics.failure(.publicFunctionCall)
        }
    }

    func result(_ output: [[String: Any]]) throws -> ChatGPTPublicWebSearchResult? {
        guard enabled else { return nil }
        let calls = output.filter { $0["type"] as? String == "web_search_call" }
        let ids = calls.compactMap { $0["id"] as? String }
        guard !calls.isEmpty,
              ids.count == calls.count, !ids.contains(""), Set(ids).count == ids.count,
              observedIDs.isSubset(of: Set(ids)),
              !output.contains(where: { $0["type"] as? String == "function_call" }),
              calls.allSatisfy({
                  let action = $0["action"] as? [String: Any]
                  return $0["status"] as? String == "completed" &&
                      ["search", "open_page", "find_in_page"].contains(action?["type"] as? String ?? "")
              })
        else { throw ResponsesMalformedDiagnostics.failure(.publicCompletedCalls) }

        var citations = [ChatGPTWebCitation]()
        for item in output where item["type"] as? String == "message" {
            guard let parts = item["content"] as? [[String: Any]] else {
                throw ResponsesMalformedDiagnostics.failure(.publicMessageContent)
            }
            for part in parts where part["type"] as? String == "output_text" {
                guard let text = part["text"] as? String,
                      let annotations = part["annotations"] as? [[String: Any]]
                else { throw ResponsesMalformedDiagnostics.failure(.publicTextAnnotations) }
                for annotation in annotations where annotation["type"] as? String == "url_citation" {
                    let citation = try Self.citation(annotation, text: text)
                    if !citations.contains(citation) {
                        citations.append(citation)
                    }
                }
            }
        }
        guard !citations.isEmpty else { throw ResponsesMalformedDiagnostics.failure(.publicCitationsMissing) }
        return ChatGPTPublicWebSearchResult(callCount: calls.count, citations: citations)
    }

    private static func citation(_ item: [String: Any], text: String) throws -> ChatGPTWebCitation {
        guard let url = item["url"] as? String, url.utf8.count <= 2048,
              let parsed = URLComponents(string: url),
              ["https", "http"].contains(parsed.scheme?.lowercased() ?? ""),
              let host = parsed.host, !host.isEmpty, parsed.user == nil, parsed.password == nil,
              let title = item["title"] as? String,
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 256,
              let start = integer(item["start_index"]), let end = integer(item["end_index"]),
              start >= 0, end > start, end <= text.utf16.count
        else { throw ResponsesMalformedDiagnostics.failure(.publicCitationShape) }
        return ChatGPTWebCitation(url: url, title: title)
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue
        else { return nil }
        return value as? Int
    }
}
