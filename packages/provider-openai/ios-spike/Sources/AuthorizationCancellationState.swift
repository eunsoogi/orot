import Foundation

enum AuthorizationCancellationState: Equatable, Sendable {
    case awaitingAuthorization
    case credentialsStored

    var cancelButtonTitle: String {
        switch self {
        case .awaitingAuthorization: "로그인 취소"
        case .credentialsStored: "모델 확인 취소"
        }
    }

    var cancellationMessage: String {
        switch self {
        case .awaitingAuthorization: "로그인이 취소되었습니다. 인증 정보는 저장하지 않았습니다."
        case .credentialsStored: "모델 확인을 취소했습니다. ChatGPT 인증 정보는 저장되어 있습니다."
        }
    }

    func failureMessage(for error: Error, taskIsCancelled: Bool) -> String {
        if taskIsCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled {
            return cancellationMessage
        }
        return error.localizedDescription
    }
}
