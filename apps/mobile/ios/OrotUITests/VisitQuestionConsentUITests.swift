import Vision
import XCTest

/// The original synthetic workflow proves declined consent, cited review and explicit priority changes, not real provider inference.
final class VisitQuestionConsentUITests: OrotFailFastTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    /// This checks the native disclosure with a synthetic search response, not a real provider account.
    @MainActor
    func testPublicSearchShowsConsentBeforeSyntheticSearch() {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "ai-feature-visit-questions", "-OROT_PUBLIC_SEARCH_CONSENT_PROBE", "synthetic"]
        app.launch()
        let start = UITestConditions.element(app, "public-search-probe-start")
        XCTAssertTrue(start.waitForAppearance(), app.debugDescription)
        XCTAssertTrue(start.isHittable)
        start.tap()
        let sheet = UITestConditions.element(app, "inference-disclosure-sheet")
        XCTAssertTrue(sheet.waitForAppearance(), app.debugDescription)
        let allow = UITestConditions.element(app, "inference-disclosure-allow")
        XCTAssertTrue(allow.exists)
        XCTAssertTrue(allow.isHittable)
        allow.tap()
        UITestConditions.value(UITestConditions.element(app, "public-search-probe-status"), equals: "success")
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
        XCTAssertEqual(UITestConditions.wait(for: [finished]), .completed, app.debugDescription)
        XCTAssertTrue(metrics.exists, failure.exists ? UITestConditions.text(failure) : app.debugDescription)
        // Provider counts and opaque aliases are checked at the workflow boundary; this run retains native citation and OCR evidence.
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
        XCTAssertEqual(UITestConditions.wait(for: [changed]), .completed, app.debugDescription)
        try assertRenderedPriority(priority, in: app)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "synthetic-cited-questions-explicit-priority"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The synthetic provider is local; reviewed questions use the app's encrypted storage and survive a process restart.
    @MainActor
    func testReviewedQuestionsPersistAcrossRestartAndStayScopedToTheirVisit() throws {
        let app = XCUIApplication()
        defer { app.terminate() }
        app.launchArguments = ["-OROT_TEST_PROFILE", "next-visit-questions", "-OROT_VISIT_QUESTION_PERSISTENCE", "synthetic"]
        // Opt-in observation retains only selection, focus and length, never the question text.
        let observation = ProcessInfo.processInfo.environment["OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION"] == "1" ? EncounterInputObservation() : nil
        if let observation {
            app.launchArguments += ["-OROT_TEST_VISIT_QUESTION_INPUT_OBSERVATION", observation.run.uuidString]
        }
        app.launch()
        XCTAssertTrue(UITestConditions.exists(node(app, "visit-persistence-ready")), app.debugDescription)
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-saved-empty")), app.debugDescription)
        let generate = node(app, "next-visit-generate")
        _ = try XCTUnwrap(FormUITestConditions.reveal(generate, in: app, scrollID: "next-visit-questions-scroll"))
        XCTAssertTrue(generate.isHittable)
        generate.tap()
        let input = node(app, "next-visit-question-text-0")
        XCTAssertTrue(FormUITestConditions.replace(input, with: "합성 질문을 진료에서 확인할까요?", in: app, scrollID: "next-visit-questions-scroll", observeInput: observation.map { observer in
            { phase in observer.captureUIKit(phase, app: app, testCase: self) }
        }))
        let save = node(app, "next-visit-review-save")
        _ = try XCTUnwrap(FormUITestConditions.reveal(save, in: app, scrollID: "next-visit-questions-scroll", avoiding: input))
        XCTAssertTrue(save.isHittable)
        save.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-saved-list")), app.debugDescription)
        let snapshot = node(app, "visit-persistence-snapshot")
        let savedIDs = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            let value = UITestConditions.text(snapshot)
            return value.hasPrefix("[\"") && value != "[]"
        }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [savedIDs]), .completed, app.debugDescription)
        let originalIDs = UITestConditions.text(snapshot)
        let originalProcess = UITestConditions.text(node(app, "visit-persistence-process"))
        XCTAssertFalse(originalProcess.isEmpty)
        app.terminate()
        app.launch()
        XCTAssertTrue(UITestConditions.exists(node(app, "visit-persistence-ready")), app.debugDescription)
        XCTAssertNotEqual(UITestConditions.text(node(app, "visit-persistence-process")), originalProcess)
        UITestConditions.value(node(app, "visit-persistence-snapshot"), equals: originalIDs)
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-saved-list")), app.debugDescription)
        // Fabric exposes the same rendered text as nested accessibility elements.
        let saved = app.staticTexts.matching(identifier: "합성 질문을 진료에서 확인할까요?").firstMatch
        _ = FormUITestConditions.reveal(saved, in: app, scrollID: "next-visit-questions-scroll", requireHittable: false)
        XCTAssertTrue(saved.exists, app.debugDescription)
        let edit = node(app, "next-visit-saved-edit")
        _ = try XCTUnwrap(FormUITestConditions.reveal(edit, in: app, scrollID: "next-visit-questions-scroll"))
        XCTAssertTrue(edit.isHittable)
        edit.tap()
        let restoredInput = node(app, "next-visit-question-text-0")
        XCTAssertTrue(FormUITestConditions.replace(restoredInput, with: "수정한 합성 질문을 확인할까요?", in: app, scrollID: "next-visit-questions-scroll", observeInput: observation.map { observer in
            { phase in observer.captureUIKit(phase, app: app, testCase: self) }
        }))
        let resave = node(app, "next-visit-review-save")
        _ = try XCTUnwrap(FormUITestConditions.reveal(resave, in: app, scrollID: "next-visit-questions-scroll", avoiding: restoredInput))
        XCTAssertTrue(resave.isHittable)
        resave.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-saved-list")), app.debugDescription)
        let editedProcess = UITestConditions.text(node(app, "visit-persistence-process"))
        app.terminate()
        app.launch()
        XCTAssertTrue(UITestConditions.exists(node(app, "visit-persistence-ready")), app.debugDescription)
        XCTAssertNotEqual(UITestConditions.text(node(app, "visit-persistence-process")), editedProcess)
        UITestConditions.value(node(app, "visit-persistence-snapshot"), equals: originalIDs)
        let edited = app.staticTexts.matching(identifier: "수정한 합성 질문을 확인할까요?").firstMatch
        _ = FormUITestConditions.reveal(edited, in: app, scrollID: "next-visit-questions-scroll", requireHittable: false)
        XCTAssertTrue(edited.exists, app.debugDescription)
        let changeVisit = node(app, "visit-persistence-switch")
        XCTAssertTrue(changeVisit.isHittable)
        changeVisit.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-saved-empty")), app.debugDescription)
        XCTAssertFalse(edited.exists)
        XCTAssertTrue(changeVisit.isHittable)
        changeVisit.tap()
        XCTAssertTrue(UITestConditions.exists(node(app, "next-visit-saved-list")), app.debugDescription)
        _ = FormUITestConditions.reveal(edited, in: app, scrollID: "next-visit-questions-scroll", requireHittable: false)
        XCTAssertTrue(edited.exists, app.debugDescription)
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) {
        let target = node(app, id)
        XCTAssertTrue(target.waitForAppearance(), app.debugDescription)
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
