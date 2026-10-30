import Darwin
import XCTest

/// Opt-in observation of an existing production installation. No fixture state or consent is injected.
@MainActor
final class ProductionRagConversationUITests: XCTestCase {
    /// The opt-in probe never enters the conversation path or submits a question.
    func testProductionCancellationBeforeSend() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let rawPort = environment["OROT_PRODUCTION_CANCEL_PORT"],
              let port = UInt16(rawPort), port > 0,
              let token = environment["OROT_PRODUCTION_CANCEL_TOKEN"], UUID(uuidString: token) != nil
        else { throw failure("cancellation_probe_configuration_missing") }
        let app = XCUIApplication(bundleIdentifier: "com.orot.mobile")
        app.launchArguments = ["-OROT_PROVIDER_DIAGNOSTICS", "-OROT_NATIVE_TOOL_TRACE"]
        app.launch()
        defer { app.terminate() }
        // Complete a real AX query before announcing readiness without recording its contents.
        _ = try app.windows.firstMatch.snapshot()
        try await holdCancellationProbe(port: port, token: token)
    }

    /// Keep the socket read off the main actor. EOF or unexpected data always fails the probe.
    private func holdCancellationProbe(port: UInt16, token: String) async throws -> Never {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let connection = socket(AF_INET, SOCK_STREAM, 0)
                    guard connection >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                    defer { close(connection) }
                    var noSignal: Int32 = 1
                    guard setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
                        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
                    }
                    var address = sockaddr_in()
                    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    address.sin_family = sa_family_t(AF_INET)
                    address.sin_port = port.bigEndian
                    address.sin_addr.s_addr = inet_addr("127.0.0.1")
                    let connected = withUnsafePointer(to: &address) {
                        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            connect(connection, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                        }
                    }
                    guard connected == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                    let frame = Array("v1 ready \(token) \(getpid())\n".utf8)
                    let sent = frame.withUnsafeBytes { bytes in send(connection, bytes.baseAddress, bytes.count, 0) }
                    guard sent == frame.count else { throw NSError(domain: "ProductionCancellationProbe", code: 1) }
                    var byte: UInt8 = 0
                    _ = read(connection, &byte, 1)
                    // No host response can release the probe into the ordinary conversation test.
                    throw NSError(domain: "ProductionCancellationProbe", code: 2)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func testProductionConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orot.mobile")
        app.launchArguments = ["-OROT_PROVIDER_DIAGNOSTICS", "-OROT_NATIVE_TOOL_TRACE"]
        app.launch()
        defer { app.terminate() }
        stage("harness_launched")

        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        try tap(app, "ai-feature-rag-conversation")
        guard UITestConditions.exists(node(app, "rag-conversation-screen")) else { throw failure("conversation_unavailable") }
        try tap(app, "ai-feature-select-provider")
        guard UITestConditions.exists(node(app, "provider-selection-screen")) else { throw failure("provider_selection_unavailable") }
        let apple = node(app, "provider-option-0")
        guard apple.exists, apple.isEnabled, apple.label.contains("Apple Intelligence") else {
            throw failure("apple_intelligence_unavailable_or_unknown")
        }
        apple.tap()
        try tap(app, "provider-selection-confirm")
        guard UITestConditions.exists(node(app, "rag-conversation-screen")) else { throw failure("provider_return_unavailable") }
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.node(app, "ai-feature-select-provider").label.contains("Apple Intelligence")
        }, object: nil)
        guard UITestConditions.wait(for: [selected]) == .completed else {
            throw failure("apple_selection_not_confirmed")
        }
        stage("apple_intelligence_selected")

        // A new conversation preserves existing sessions and prevents old citations from satisfying this run.
        try tap(app, "rag-conversation-new-session")
        let question = "내 증상 기록을 요약해줘"
        let sourceLists = app.descendants(matching: .any).matching(identifier: "rag-conversation-sources")
        guard sourceLists.count == 0 else { throw failure("new_conversation_not_empty") }
        let input = node(app, "rag-conversation-input")
        guard input.exists, input.isHittable else { throw failure("input_unavailable") }
        input.tap()
        input.typeText(question)
        // Never submit an incomplete or altered clinical question, even after an XCTest assertion fails.
        guard (try? input.snapshot().value as? String) == question else { throw failure("input_mismatch_not_submitted") }
        stage("exact_input_verified")
        try tap(app, "rag-conversation-send")
        stage("submitted_once")

        // Citations appear only on a completed grounded response, not on streamed draft text.
        let failures = [
            ("이 질문에 답할 만한 저장된 근거를 찾지 못했어요.", "no_evidence"),
            ("근거가 부족하거나 서로 맞지 않아 답을 만들지 않았어요.", "insufficient_evidence"),
            ("답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", "answer_unavailable"),
        ]
        let newSources = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            sourceLists.count > 0 || self.node(app, "inference-disclosure-sheet").exists ||
                failures.contains { app.staticTexts[$0.0].exists }
        }, object: nil)
        guard UITestConditions.wait(for: [newSources]) == .completed else { throw failure("validated_citations_unavailable") }
        if node(app, "inference-disclosure-sheet").exists {
            throw failure("consent_required")
        }
        for (text, status) in failures where app.staticTexts[text].exists {
            throw failure(status)
        }
        guard sourceLists.count > 0 else { throw failure("validated_citations_unavailable") }
        // Citations do not prove that the completed assistant body itself is displayed.
        let answerBody = node(app, "rag-conversation-answer-body")
        let history = node(app, "rag-conversation-history")
        guard answerBody.exists, history.exists else { throw failure("assistant_answer_body_unavailable") }
        let answerText = UITestConditions.text(answerBody).trimmingCharacters(in: .whitespacesAndNewlines)
        let visibleAnswerFrame = answerBody.frame.intersection(history.frame)
        guard !answerText.isEmpty,
              !visibleAnswerFrame.isNull,
              visibleAnswerFrame.width > 0,
              visibleAnswerFrame.height > 0
        else { throw failure("assistant_answer_body_not_visible") }
        stage("assistant_answer_body_visible")
        let sources = sourceLists.firstMatch
        stage("validated_citations_visible")
        let source = sources.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "원문 근거 열기")).firstMatch
        guard source.exists, source.isHittable else { throw failure("source_action_unavailable") }
        source.tap()
        guard UITestConditions.exists(node(app, "ai-feature-source-detail")) else { throw failure("source_navigation_unavailable") }
        stage("source_navigation_visible")
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) throws {
        let element = node(app, id)
        guard element.exists, element.isHittable, element.isEnabled else { throw failure("control_unavailable_\(id)") }
        element.tap()
    }

    private func failure(_ stage: String) -> NSError {
        self.stage(stage)
        return NSError(domain: "ProductionConversation", code: 1, userInfo: [NSLocalizedDescriptionKey: stage])
    }

    private func stage(_ name: String) {
        let attachment = XCTAttachment(string: name)
        attachment.name = "production-conversation-stage"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
