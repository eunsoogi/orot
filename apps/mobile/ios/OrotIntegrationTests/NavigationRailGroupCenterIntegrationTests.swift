@testable import Orot
import UIKit
import XCTest

final class NavigationRailGroupCenterIntegrationTests: OrotFailFastTestCase {
    @MainActor
    func testPageActionAndRootTabsShareTheMeasuredUsableWindowCenter() throws {
        let scene = try XCTUnwrap(
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive },
        )
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(x: 0, y: 0, width: 951, height: 768)
        let controller = UIViewController()
        window.rootViewController = controller
        controller.view.frame = window.bounds
        window.isHidden = false
        defer { window.isHidden = true }

        // The recorded usable rail is y=136...623; its 12pt native gutters produce these insets.
        let rootSurface = NavigationGlassSurfaceView(
            frame: CGRect(x: 891, y: 0, width: 60, height: 768),
        )
        controller.view.addSubview(rootSurface)
        rootSurface.layoutMode = "right"
        rootSurface.railRightInset = 12
        rootSurface.railTopInset = 204
        rootSurface.railBottomInset = 157
        rootSurface.railAvailableHeight = 768
        rootSurface.actions = [
            ["id": "tab-home", "label": "Home", "accessibilityLabel": "Home tab", "testID": "navigation-tab-home", "rootTab": true, "selected": true, "systemImageName": "house.fill"],
            ["id": "tab-records", "label": "Records", "accessibilityLabel": "Records tab", "testID": "navigation-tab-records", "rootTab": true, "selected": false, "systemImageName": "doc.text"],
            ["id": "tab-schedule", "label": "Schedule", "accessibilityLabel": "Schedule tab", "testID": "navigation-tab-schedule", "rootTab": true, "selected": false, "systemImageName": "calendar"],
            ["id": "tab-ai", "label": "AI", "accessibilityLabel": "AI tab", "testID": "navigation-tab-ai", "rootTab": true, "selected": false, "systemImageName": "sparkles"],
            ["id": "tab-settings", "label": "Settings", "accessibilityLabel": "Settings tab", "testID": "navigation-tab-settings", "rootTab": true, "selected": false, "systemImageName": "gearshape"],
        ] as NSArray

        let pageSurface = NavigationGlassSurfaceView(
            frame: CGRect(x: 891, y: 0, width: 60, height: 768),
        )
        controller.view.addSubview(pageSurface)
        pageSurface.isPageDock = true
        pageSurface.layoutMode = "right"
        pageSurface.railRightInset = 12
        pageSurface.railTopInset = 148
        pageSurface.railBottomInset = 506.5
        pageSurface.railAvailableHeight = 768
        pageSurface.actions = [[
            "id": "page:continue",
            "label": "Continue",
            "accessibilityLabel": "Continue",
            "testID": "page-continue",
            "systemImageName": "arrow.right",
            "primary": true,
        ]] as NSArray

        rootSurface.layoutIfNeeded()
        pageSurface.layoutIfNeeded()
        let hosts = controller.view.subviews.compactMap { $0 as? NavigationWindowRailHost }
        let rootHost = try XCTUnwrap(hosts.first)
        let pageHost = try XCTUnwrap(hosts.last)
        rootHost.layoutIfNeeded()
        pageHost.layoutIfNeeded()
        let rootBar = try XCTUnwrap(rootHost.subviews.compactMap { $0 as? NavigationRootGlassBar }.first)
        let rootStack = try XCTUnwrap(rootBar.contentView.subviews.compactMap { $0 as? UIStackView }.first)
        let rootButton = try XCTUnwrap(rootStack.arrangedSubviews.compactMap { $0 as? UIButton }.first)
        let pageStack = try XCTUnwrap(pageHost.subviews.compactMap { $0 as? UIStackView }.first)
        let pageButton = try XCTUnwrap(pageStack.arrangedSubviews.compactMap { $0 as? UIButton }.first)
        pageStack.layoutIfNeeded()
        rootStack.layoutIfNeeded()

        let usableRail = CGRect(x: 0, y: 136, width: 951, height: 487)
        let rootFrame = rootBar.convert(rootBar.bounds, to: window)
        let pageFrame = pageButton.convert(pageButton.bounds, to: window)
        let rootGlyph = try XCTUnwrap(rootButton.subviews.compactMap { $0 as? UIStackView }.first?.arrangedSubviews.compactMap { $0 as? UIImageView }.first)
        let pageGlyph = try XCTUnwrap(firstImageView(in: pageButton))
        let rootGlyphFrame = rootGlyph.convert(rootGlyph.bounds, to: window)
        let pageGlyphFrame = pageGlyph.convert(pageGlyph.bounds, to: window)
        let completeGroupCenter = (pageFrame.minY + rootFrame.maxY) / 2

        XCTAssertTrue(window.bounds.contains(rootFrame) && window.bounds.contains(pageFrame))
        XCTAssertTrue(usableRail.contains(rootFrame) && usableRail.contains(pageFrame))
        XCTAssertEqual(rootFrame.height, NavigationRootGlassBar.railHeight, accuracy: 0.5)
        XCTAssertEqual(pageFrame.width, 48, accuracy: 0.5)
        XCTAssertEqual(pageFrame.height, 48, accuracy: 0.5)
        XCTAssertEqual(rootFrame.minY - pageFrame.maxY, 8, accuracy: 0.5)
        XCTAssertEqual(completeGroupCenter, usableRail.midY, accuracy: 0.5)
        XCTAssertTrue(rootFrame.contains(rootGlyphFrame) && window.bounds.contains(rootGlyphFrame))
        XCTAssertTrue(pageFrame.contains(pageGlyphFrame) && window.bounds.contains(pageGlyphFrame))
        XCTAssertTrue(window.hitTest(rootButton.convert(CGPoint(x: 24, y: 26), to: window), with: nil) === rootButton)
        XCTAssertTrue(window.hitTest(pageButton.convert(CGPoint(x: 24, y: 24), to: window), with: nil) === pageButton)
    }

    @MainActor
    private func firstImageView(in view: UIView) -> UIImageView? {
        if let imageView = view as? UIImageView { return imageView }
        for child in view.subviews {
            if let imageView = firstImageView(in: child) { return imageView }
        }
        return nil
    }
}
