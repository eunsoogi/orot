import Vision
import XCTest

/// The original synthetic workflow proves declined consent, cited review and explicit priority changes, not real provider inference.
final class VisitQuestionConsentUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testDeclinedRemoteConsentStopsSendsAndCitedQuestionsRemainReviewable() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "visit-questions", "-OROT_VISIT_QUESTIONS_PROBE", "synthetic"]
        app.launch()
        tap(app, "visit-question-probe-decline-consent")
        UITestConditions.value(node(app, "visit-question-probe-consent-result"), equals: "외부 전송 동의 거절 · provider sends: 0")
        tap(app, "visit-question-probe-prepare")
        let metrics = node(app, "visit-question-probe-metrics")
        let failure = node(app, "visit-question-probe-failure")
        let finished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in metrics.exists || failure.exists }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [finished], timeout: 30), .completed, app.debugDescription)
        XCTAssertTrue(metrics.exists, failure.exists ? UITestConditions.text(failure) : app.debugDescription)
        UITestConditions.value(node(app, "visit-question-probe-metrics"), equals: "synthetic=true · provider calls=3 · evidence references=2 · raw IDs exposed=false")
        let citations = node(app, "visit-question-probe-scroll").descendants(matching: .staticText).matching(NSPredicate(format: "label == %@", "이 프로브에만 쓰는 합성 검사 기록입니다."))
        // Fabric exposes both a text wrapper and its UILabel. Count distinct rendered citations, rather than selecting a duplicate of an earlier card.
        var rendered: [XCUIElement] = []
        for candidate in citations.allElementsBoundByIndex where !candidate.frame.isEmpty {
            if !rendered.contains(where: { $0.frame == candidate.frame }) {
                rendered.append(candidate)
            }
        }
        rendered.sort { $0.frame.minY < $1.frame.minY }
        guard rendered.count >= 3 else {
            XCTFail("Expected three distinct rendered citations; \(app.debugDescription)")
            return
        }
        let third = rendered[2]
        reveal(third, in: app)
        XCTAssertTrue(third.isHittable)
        let priority = node(app, "visit-question-priority-2")
        reveal(priority, in: app)
        priority.tap()
        let changed = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            priority.isSelected
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [changed], timeout: 10), .completed, app.debugDescription)
        try assertRenderedPriority(priority, in: app)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "synthetic-cited-questions-explicit-priority"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForExistence(timeout: 30), app.debugDescription)
        reveal(target, in: app)
        let frame = target.frame
        XCTAssertTrue(!frame.isEmpty && app.frame.contains(frame), target.debugDescription)
        // Use the current measured button frame after the consent result has reflowed the standalone screen.
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX - app.frame.minX,
                                                                        dy: frame.midY - app.frame.minY)).tap()
    }

    @MainActor
    private func reveal(_ target: XCUIElement, in app: XCUIApplication) {
        let scroll = node(app, "visit-question-probe-scroll")
        // Drag the scroller's padding: multiline native editors inside the cards consume gestures through their own text viewport.
        FormUITestConditions.reveal(target, in: app, scrollID: "visit-question-probe-scroll",
                                    towardTop: target.frame.minY < scroll.frame.minY, horizontalPosition: 0.03)
    }

    @MainActor
    private func assertRenderedPriority(_ priority: XCUIElement, in app: XCUIApplication) throws {
        // The native accessible button replaces its Text child's AX label. Read only this button's rendered pixels, not another important card.
        let image = try XCTUnwrap(app.screenshot().image.cgImage)
        let scaleX = CGFloat(image.width) / app.frame.width
        let scaleY = CGFloat(image.height) / app.frame.height
        let frame = priority.frame.offsetBy(dx: -app.frame.minX, dy: -app.frame.minY)
        let crop = try XCTUnwrap(image.cropping(to: CGRect(x: frame.minX * scaleX, y: frame.minY * scaleY,
                                                           width: frame.width * scaleX, height: frame.height * scaleY)))
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["ko-KR"]
        try VNImageRequestHandler(cgImage: crop).perform([request])
        let rendered = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        // Vision reads the small centered separator as a bullet; retain every Korean word and normalize only that observed glyph.
        XCTAssertEqual(rendered.replacingOccurrences(of: " • ", with: " · "), "중요 질문 · 우선순위 변경")
    }
}
