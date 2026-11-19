import XCTest

/// Uses restored synthetic turns to observe independent foreground and real-scene resize boundaries.
@MainActor
enum SyntheticProfileBackdropUITestConditions {
    static func run(_ testCase: XCTestCase, rotation: Bool, portraitCapture: Bool = false) throws {
        let session = UUID().uuidString
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            if rotation || portraitCapture {
                XCUIDevice.shared.orientation = originalOrientation
            }
        }
        if rotation || portraitCapture {
            XCUIDevice.shared.orientation = .portrait
        }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-OROT_TEST_LONG_CONVERSATION_VISUAL", "YES", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        // Only the resize case mounts the native scene request control; foreground has no probe overlay.
        if rotation {
            app.launchArguments += ["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_ROTATION_GEOMETRY_SESSION", session]
        }
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let star = UITestConditions.element(app, "별")
        let screen = UITestConditions.element(app, "rag-conversation-screen")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in star.exists || screen.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        if star.exists {
            NavigationForegroundUITestConditions.prepareFreshAppearance(app)
        }
        let history = UITestConditions.element(app, "rag-conversation-history")
        let profile = UITestConditions.element(app, "assistant-floating-overlay")
        XCTAssertTrue(UITestConditions.exists(history) && UITestConditions.exists(profile))
        let lastAnswer = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "합성 답변 24")).firstMatch
        let markers = (1 ... 23).map { number in
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "합성 답변 \(number):")).firstMatch
        }
        XCTAssertTrue(UITestConditions.exists(lastAnswer) && lastAnswer.isHittable)
        let before = lastAnswer.frame
        let visibleBefore = markers.map { $0.exists && $0.isHittable }
        let beforeImage = XCTAttachment(screenshot: app.screenshot())
        beforeImage.name = "synthetic-profile-before-scroll"
        beforeImage.lifetime = .keepAlways
        testCase.add(beforeImage)
        history.swipeDown()
        let after = lastAnswer.exists ? lastAnswer.frame : .null
        let newlyVisible = markers.enumerated().compactMap { index, marker in
            !visibleBefore[index] && marker.exists && marker.isHittable ? index + 1 : nil
        }
        XCTAssertTrue((lastAnswer.exists && after.minY > before.minY) || !newlyVisible.isEmpty, "The gesture must move restored transcript content")
        let rail = UITestConditions.element(app, "navigation-root-tabs-glass-backdrop")
        XCTAssertTrue(rail.exists)
        let frames = XCTAttachment(string: "profile=\(profile.frame), history=\(history.frame), rail=\(rail.frame), app=\(app.frame), lastBefore=\(before), lastAfter=\(after), newlyVisible=\(newlyVisible)")
        frames.name = "synthetic-profile-history-frames"
        frames.lifetime = .keepAlways
        testCase.add(frames)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "synthetic-scrolled-profile"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
        if portraitCapture {
            // Match the painted body to its synthetic answer; text bounds alone do not describe its edge.
            let bodies = app.otherElements.matching(identifier: "conversation-message-body")
            func card(for number: Int) -> XCUIElement? {
                let answerText = "합성 답변 \(number):"
                return bodies.allElementsBoundByIndex.first {
                    $0.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", answerText)).firstMatch.exists
                }
            }
            let profileFrame = profile.frame
            let historyFrame = history.frame
            let start = CGPoint(x: historyFrame.minX + 40, y: min(historyFrame.maxY - 100, profileFrame.maxY + 190))
            let maxDistance = start.y - (historyFrame.minY + 20)
            let candidates = bodies.allElementsBoundByIndex.compactMap { body -> (Int, CGRect)? in
                let label = body.staticTexts.allElementsBoundByIndex.map(\.label).first { $0.hasPrefix("합성 답변 ") }
                guard let label,
                      let prefix = label.split(separator: ":", maxSplits: 1).first,
                      let number = Int(prefix.dropFirst("합성 답변 ".count)), (1 ... 24).contains(number) else { return nil }
                let frame = body.frame
                guard frame.minY > profileFrame.maxY, frame.intersects(historyFrame),
                      frame.minY - (profileFrame.maxY - 12) <= maxDistance else { return nil }
                return (number, frame)
            }
            let candidatesEvidence = XCTAttachment(string: "profile=\(profileFrame), history=\(historyFrame), app=\(app.frame), candidates=\(candidates)")
            candidatesEvidence.name = "synthetic-profile-portrait-candidates"
            candidatesEvidence.lifetime = .keepAlways
            testCase.add(candidatesEvidence)
            let beforeImage = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            beforeImage.name = "synthetic-profile-portrait-before-drag"
            beforeImage.lifetime = .keepAlways
            testCase.add(beforeImage)
            let candidate = try XCTUnwrap(candidates.min { $0.1.minY < $1.1.minY }, "A painted answer below the profile must be exposed in the accessibility tree")
            let (answerNumber, beforeBody) = candidate
            let distance = max(0, beforeBody.minY - (profileFrame.maxY - 12))
            let end = CGPoint(x: start.x, y: max(historyFrame.minY + 20, start.y - distance))
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: start.x - app.frame.minX, dy: start.y - app.frame.minY))
                .press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: end.x - app.frame.minX, dy: end.y - app.frame.minY)), withVelocity: .slow, thenHoldForDuration: 0.1)
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = "synthetic-profile-portrait-card"
            image.lifetime = .keepAlways
            testCase.add(image)
            let afterBody = try XCTUnwrap(card(for: answerNumber), "The same synthetic answer must remain identifiable after the drag").frame
            let afterProfile = profile.frame
            let evidence = XCTAttachment(string: "answer=\(answerNumber), profileBefore=\(profileFrame), profileAfter=\(afterProfile), history=\(historyFrame), app=\(app.frame), bodyBefore=\(beforeBody), bodyAfter=\(afterBody), dragStart=\(start), dragEnd=\(end)")
            evidence.name = "synthetic-profile-portrait-card-frames"
            evidence.lifetime = .keepAlways
            testCase.add(evidence)
            XCTAssertGreaterThan(app.frame.height, app.frame.width, "The captured viewport must be portrait")
            XCTAssertTrue(historyFrame.contains(start) && app.frame.contains(start))
            XCTAssertGreaterThan(start.y, end.y)
            XCTAssertLessThan(afterBody.minY, beforeBody.minY)
            XCTAssertTrue(afterBody.intersects(afterProfile), "The actual painted card must cross the profile backdrop")
            return
        }
        if rotation {
            let beforeWidth = history.frame.width
            _ = try NavigationRotationUITestConditions.rotateObservedScene(app, session: session, landscape: true, scrollID: "rag-conversation-history")
            XCTAssertTrue(history.exists && profile.exists && rail.exists)
            XCTAssertGreaterThan(abs(history.frame.width - beforeWidth), 0.5, "The transcript viewport must actually resize")
            // Start within the transcript below the profile and drag toward its opaque region.
            let historyFrame = history.frame
            let profileFrame = profile.frame
            let firstAnswerBefore = markers[0].frame
            let start = CGPoint(x: historyFrame.minX + 40, y: min(historyFrame.maxY - 100, profileFrame.maxY + 190))
            // Aim the first answer just inside the profile, without the momentum of the default swipe.
            let distance = max(0, firstAnswerBefore.minY - (profileFrame.maxY - 12))
            let end = CGPoint(x: start.x, y: max(historyFrame.minY + 20, start.y - distance))
            let dragFrames = XCTAttachment(string: "history=\(historyFrame), profile=\(profileFrame), firstAnswerBefore=\(firstAnswerBefore), dragStart=\(start), dragEnd=\(end)")
            dragFrames.name = "synthetic-profile-after-resize-drag"
            dragFrames.lifetime = .keepAlways
            testCase.add(dragFrames)
            let origin = app.coordinate(withNormalizedOffset: .zero)
            origin.withOffset(CGVector(dx: start.x - app.frame.minX, dy: start.y - app.frame.minY))
                .press(forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: end.x - app.frame.minX, dy: end.y - app.frame.minY)), withVelocity: .slow, thenHoldForDuration: 0.1)
            let overlappingAnswers = (markers + [lastAnswer]).filter {
                $0.exists && $0.frame.intersects(profile.frame)
            }
            let overlapFrames = "firstAnswerAfter=\(markers[0].frame)\n" + overlappingAnswers.map { "\($0.label.prefix(24)): \($0.frame)" }.joined(separator: "\n")
            let geometry = XCTAttachment(string: "profile=\(profile.frame), history=\(history.frame), rail=\(rail.frame), app=\(app.frame)")
            geometry.name = "synthetic-profile-after-resize-frames"
            geometry.lifetime = .keepAlways
            testCase.add(geometry)
            let overlap = XCTAttachment(string: overlapFrames)
            overlap.name = "synthetic-profile-after-resize-overlap"
            overlap.lifetime = .keepAlways
            testCase.add(overlap)
            // The app screenshot can retain portrait dimensions after a scene resize; capture the display too.
            let image = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            image.name = "synthetic-profile-after-resize"
            image.lifetime = .keepAlways
            testCase.add(image)
            XCTAssertTrue(historyFrame.contains(start) && app.frame.contains(start), "The drag must start inside the visible history")
            XCTAssertGreaterThan(start.y, end.y, "The drag must move toward the profile")
            XCTAssertLessThan(markers[0].frame.minY, firstAnswerBefore.minY, "The drag must move the observed answer upward")
            XCTAssertFalse(overlappingAnswers.isEmpty, "An answer must cross the profile backdrop in the resized scene")
            return
        }
        XCUIDevice.shared.press(.home)
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        }, object: nil)
        let backgroundResult = XCTWaiter.wait(for: [background], timeout: 10)
        let backgroundState = XCTAttachment(string: "applicationState=\(app.state.rawValue), waitResult=\(backgroundResult.rawValue)")
        backgroundState.name = "synthetic-profile-background-state"
        backgroundState.lifetime = .keepAlways
        testCase.add(backgroundState)
        XCTAssertEqual(backgroundResult, .completed)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(history.exists && profile.exists && rail.exists)
        let restoredFrames = XCTAttachment(string: "profile=\(profile.frame), history=\(history.frame), rail=\(rail.frame), app=\(app.frame)")
        restoredFrames.name = "synthetic-profile-after-foreground-frames"
        restoredFrames.lifetime = .keepAlways
        testCase.add(restoredFrames)
        let restoredImage = XCTAttachment(screenshot: app.screenshot())
        restoredImage.name = "synthetic-profile-after-foreground"
        restoredImage.lifetime = .keepAlways
        testCase.add(restoredImage)
    }
}
