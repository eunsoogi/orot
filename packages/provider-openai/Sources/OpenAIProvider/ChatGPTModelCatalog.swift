import Foundation

public extension ChatGPTOAuthClient {
    func listModels(for account: ChatGPTAccountAccess) async throws -> [ListedChatGPTModel] {
        guard account.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }

        var request = URLRequest(url: URL(string: "\(ChatGPTOAuthConstants.resource)/models")!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(account.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ChatGPTOAuthError.modelCatalogUnavailable
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              data.count <= 1_048_576,
              let body = try? JSONDecoder().decode(ModelCatalogResponse.self, from: data) else {
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
