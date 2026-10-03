import Foundation

enum ResponsesHTTPFailureParser {
    private static let maximumBodyBytes = 65_536

    static func diagnostics(
        for stream: AsyncThrowingStream<Data, Error>,
        statusCode: Int,
        requestID: String?
    ) async throws -> ChatGPTResponsesDiagnostics {
        var body = Data()
        var truncated = false
        do {
            for try await chunk in stream {
                let remaining = Self.maximumBodyBytes - body.count
                guard remaining > 0 else {
                    truncated = true
                    break
                }
                if chunk.count > remaining {
                    body.append(chunk.prefix(remaining))
                    truncated = true
                    break
                }
                body.append(chunk)
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            truncated = true
        }

        return Self.diagnostics(statusCode: statusCode, requestID: requestID, body: body, truncated: truncated)
    }

    static func diagnostics(
        statusCode: Int,
        requestID: String?,
        body: Data
    ) -> ChatGPTResponsesDiagnostics {
        let truncated = body.count > maximumBodyBytes
        return diagnostics(
            statusCode: statusCode,
            requestID: requestID,
            body: Data(body.prefix(maximumBodyBytes)),
            truncated: truncated
        )
    }

    private static func diagnostics(
        statusCode: Int,
        requestID: String?,
        body: Data,
        truncated: Bool
    ) -> ChatGPTResponsesDiagnostics {
        let parsed = Self.parse(body)
        return ChatGPTResponsesDiagnostics(
            httpStatusCode: statusCode,
            bodyShape: parsed.shape,
            bodyTruncated: truncated,
            code: parsed.code,
            parameter: parsed.parameter,
            requestID: requestID
        )
    }

    private static func parse(_ body: Data) -> (shape: String, code: String?, parameter: String?) {
        guard !body.isEmpty else { return ("empty", nil, nil) }
        guard let object = try? JSONSerialization.jsonObject(with: body),
              let dictionary = object as? [String: Any] else {
            return ("non_json", nil, nil)
        }
        if let error = dictionary["error"] as? [String: Any] {
            return ("error_object", error["code"] as? String, error["param"] as? String)
        }
        if dictionary.keys.contains("detail") { return ("detail_object", nil, nil) }
        return ("json_object", nil, nil)
    }
}
