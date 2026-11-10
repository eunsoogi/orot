import XCTest

/// Keep Home's metric-card reveal separate from activation and checkbox state changes.
@MainActor
enum HomeMetricScrollUITestConditions {
    /// Reveal a noninteractive accessibility card with the Home scroll instead of tapping through navigation.
    static func revealCard(
        _ card: XCUIElement,
        in app: XCUIApplication,
        homeScroll: XCUIElement,
        navigationOcclusion: XCUIElement,
    ) {
        XCTAssertEqual(homeScroll.identifier, "navigation-route-scroll")
        let scrollView = homeScroll.scrollViews.firstMatch
        XCTAssertTrue(UITestConditions.exists(scrollView))
        let containmentTolerance: CGFloat = 0.001

        for attempt in 0 ... 8 {
            let applicationFrame = app.frame
            let window = app.windows.firstMatch
            guard window.exists else {
                XCTFail("The Home metric has no app window")
                return
            }
            guard navigationOcclusion.exists else {
                XCTFail("The Home metric has no active navigation occlusion")
                return
            }
            let windowFrame = window.frame
            let routeFrame = homeScroll.frame
            let scrollFrame = scrollView.frame
            let navigationFrame = navigationOcclusion.frame
            guard let viewport = HomeMetricScrollGeometry.unobscuredViewport(
                application: applicationFrame,
                window: windowFrame,
                route: routeFrame,
                scroll: scrollFrame,
                navigationOcclusion: navigationFrame,
            ),
                let geometry = FormScrollGeometry(
                    application: applicationFrame,
                    scroll: viewport,
                    keyboard: nil,
                )
            else {
                XCTFail(
                    "The Home metric has no finite unobscured viewport: app=\(applicationFrame), " +
                        "window=\(windowFrame), route=\(routeFrame), scroll=\(scrollFrame), " +
                        "navigation=\(navigationFrame)",
                )
                return
            }
            guard card.exists else {
                XCTFail("The Home metric card is missing: \(card.identifier)")
                return
            }
            let target = card.frame
            guard FormScrollGeometry.valid(target) else {
                XCTFail("The Home metric card has no finite frame: \(card.identifier)")
                return
            }
            if HomeMetricScrollGeometry.contains(target, in: geometry.viewport) {
                return
            }
            // Keep full-card containment when it fits; taller cards remain reachable through sequential scrolling.
            let fitsHorizontally = target.minX >= geometry.viewport.minX - containmentTolerance &&
                target.maxX <= geometry.viewport.maxX + containmentTolerance
            let exceedsViewportHeight = target.height > geometry.viewport.height + containmentTolerance
            if fitsHorizontally, exceedsViewportHeight, geometry.viewport.intersects(target), card.isHittable {
                return
            }
            guard attempt < 8 else { break }

            guard let horizontalPosition = geometry.horizontalPosition(outside: target) else {
                XCTFail("The Home metric has no measured scroll corridor outside \(card.identifier)")
                return
            }
            let towardTop = target.minY < geometry.viewport.minY
            guard let gesture = geometry.gesture(
                target: target,
                towardTop: towardTop,
                horizontalPosition: horizontalPosition,
            ) else {
                XCTFail("The Home metric produced invalid measured scroll coordinates")
                return
            }

            // Anchor both touch points to the app window and keep the bounded drag outside the card.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(gesture.start)
            let end = origin.withOffset(gesture.end)
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)
        }

        XCTFail("The Home metric card did not become reachable inside its unobscured scroll viewport: \(card.identifier)")
    }

    /// Keep native card hit testing, Home selection, measured lane alignment and seven-date readability together.
    static func revealAndCaptureCards(
        in app: XCUIApplication,
        homeScroll: XCUIElement,
        navigation: NavigationUITestConditions.NavigationAction,
        testCase: XCTestCase,
    ) {
        for identifier in ["home-metric-sleep", "home-metric-heartRate"] {
            let card = UITestConditions.element(app, identifier)
            XCTAssertTrue(card.waitForAppearance())
            revealCard(card, in: app, homeScroll: homeScroll, navigationOcclusion: navigation.toolbar)
            XCTAssertTrue(card.exists && card.isHittable, identifier)
            HomeMetricGeometryConditions.captureCard(card, in: app, testCase: testCase)
            if navigation.toolbar.frame.height > navigation.toolbar.frame.width {
                XCTAssertLessThanOrEqual(card.frame.maxX, navigation.toolbar.frame.minX + 1, identifier)
            }
        }
    }

    static func toggleCheckboxAndAssertState(
        _ app: XCUIApplication,
        identifier: String,
        in homeScroll: XCUIElement,
        minimumHitHeight: CGFloat = 44,
    ) {
        let checkbox = UITestConditions.element(app, identifier)
        scrollTo(checkbox, in: app, homeScroll: homeScroll)
        UITestConditions.toggleCheckboxAndAssertState(checkbox, minimumHitHeight: minimumHitHeight)
    }

    private static func scrollTo(
        _ target: XCUIElement,
        in app: XCUIApplication,
        homeScroll: XCUIElement,
    ) {
        XCTAssertEqual(homeScroll.identifier, "navigation-route-scroll")
        let scrollView = homeScroll.scrollViews.firstMatch
        XCTAssertTrue(UITestConditions.exists(scrollView))
        // Checkboxes can be virtualized; compare state whenever the target remains observable.
        let initialChecked = target.exists ? UITestConditions.checkboxIsChecked(target) : nil

        for _ in 0 ..< 8 {
            let targetExists = target.exists
            let targetFrame = targetExists ? target.frame : nil
            let targetHittable = targetExists && target.isHittable
            if targetExists, targetHittable {
                return
            }

            let applicationFrame = app.frame
            let scrollFrame = scrollView.frame
            guard let geometry = FormScrollGeometry.current(
                application: applicationFrame,
                scroll: scrollFrame,
                keyboard: nil,
                input: nil,
                referenceSize: nil,
            ) else {
                XCTFail("The Home metric has no finite visible scroll viewport")
                return
            }

            let towardTop = targetFrame.map { $0.midY < geometry.viewport.midY } ?? false
            let horizontalPosition: CGFloat
            if let targetFrame {
                guard let outsideTarget = geometry.horizontalPosition(outside: targetFrame) else {
                    XCTFail("The Home metric has no measured scroll corridor outside its hit target")
                    return
                }
                horizontalPosition = outsideTarget
            } else {
                horizontalPosition = 0.5
            }
            guard let gesture = geometry.gesture(
                target: targetFrame,
                towardTop: towardTop,
                horizontalPosition: horizontalPosition,
            ) else {
                XCTFail("The Home metric produced invalid measured scroll coordinates")
                return
            }

            // Keep checkbox reveal on its existing Home scroll path and preserve its state during the drag.
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let start = origin.withOffset(gesture.start)
            let end = origin.withOffset(gesture.end)
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0)

            let afterExists = target.exists
            let afterChecked = afterExists ? UITestConditions.checkboxIsChecked(target) : nil
            if let initialChecked, let afterChecked {
                XCTAssertEqual(
                    afterChecked,
                    initialChecked,
                    "A measured Home scroll must preserve checkbox state before activation",
                )
            }
        }

        XCTAssertTrue(target.exists && target.isHittable, target.debugDescription)
    }
}
