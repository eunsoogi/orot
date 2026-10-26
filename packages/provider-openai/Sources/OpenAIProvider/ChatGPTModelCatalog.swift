import Foundation

public extension ChatGPTOAuthClient {
    func listModels(for account: ChatGPTAccountAccess) async throws -> [ListedChatGPTModel] {
        guard account.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        let stored = try await sessionManager.accountWithFreshAccessToken(
            issuedClientID: account.issuedClientID,
        )
        guard stored.subject == account.subject else { throw ChatGPTOAuthError.accountIdentityMismatch }
        guard stored.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        guard let accessToken = stored.credentials?.accessToken else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }
        return try await listModels(accessToken: accessToken)
    }

    func listModels(forIssuedClientID issuedClientID: String) async throws -> [ListedChatGPTModel] {
        let account = try await sessionManager.accountWithFreshAccessToken(issuedClientID: issuedClientID)
        guard account.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        guard let accessToken = account.credentials?.accessToken else {
            throw ChatGPTOAuthError.reauthorizationRequired
        }
        return try await listModels(accessToken: accessToken)
    }

    private func listModels(accessToken: String) async throws -> [ListedChatGPTModel] {
        var request = URLRequest(url: URL(string: "\(ChatGPTOAuthConstants.resource)/models")!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await transport.data(for: request)
        } catch {
            guard Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled else {
                throw ChatGPTOAuthError.modelCatalogUnavailable
            }
            throw CancellationError()
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ChatGPTOAuthError.modelCatalogUnavailable
        }
        guard httpResponse.statusCode == 200 else {
            throw ChatGPTOAuthError.modelCatalogHTTPFailure(
                ResponsesHTTPFailureParser.diagnostics(
                    statusCode: httpResponse.statusCode,
                    requestID: httpResponse.value(forHTTPHeaderField: "x-request-id"),
                    body: data,
                ),
            )
        }
        guard data.count <= 1_048_576,
              let body = try? JSONDecoder().decode(ModelCatalogResponse.self, from: data)
        else {
            throw ChatGPTOAuthError.modelCatalogUnavailable
        }

        return body.models
            .filter { $0.visibility == "list" }
            .map { ListedChatGPTModel(slug: $0.slug, displayName: $0.displayName) }
    }
}

private struct ModelCatalogResponse: Decodable {
    let models: [Model]

    struct Model: Decodable {
        let slug: String
        let displayName: String
        let visibility: String

        enum CodingKeys: String, CodingKey {
            case slug
            case displayName = "display_name"
            case visibility
        }
    }
}
