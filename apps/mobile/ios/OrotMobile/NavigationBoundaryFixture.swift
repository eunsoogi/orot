#if OROT_TESTS
    import React
    import UIKit

    /// A local diagnostic uses ordinary UIKit containment and the system's unmodified pop driver.
    @objc(OrotNavigationBoundaryViewManager)
    final class OrotNavigationBoundaryViewManager: RCTViewManager {
        override static func requiresMainQueueSetup() -> Bool {
            true
        }

        override func view() -> UIView! {
            NavigationBoundaryView()
        }
    }

    private final class NavigationBoundaryView: UIView {
        private let navigation = UINavigationController(rootViewController: BoundaryScreen(isChild: false))

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard window != nil, navigation.parent == nil else { return }
            var responder: UIResponder? = next
            while let current = responder {
                if let parent = current as? UIViewController {
                    parent.addChild(navigation)
                    addSubview(navigation.view)
                    navigation.view.frame = bounds
                    navigation.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                    navigation.didMove(toParent: parent)
                    return
                }
                responder = current.next
            }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            navigation.view.frame = bounds
        }
    }

    private final class BoundaryScreen: UIViewController {
        private let isChild: Bool
        private let surface = UIScrollView()

        init(isChild: Bool) {
            self.isChild = isChild
            super.init(nibName: nil, bundle: nil)
            title = isChild ? "UIKit child" : "UIKit root"
        }

        @available(*, unavailable)
        required init?(coder _: NSCoder) {
            fatalError("Programmatic diagnostic only")
        }

        override func viewDidLoad() {
            super.viewDidLoad()
            view.backgroundColor = .white
            surface.accessibilityIdentifier = isChild ? "boundary-child-surface" : "boundary-root-surface"
            surface.contentInsetAdjustmentBehavior = .never
            view.addSubview(surface)
            let label = UILabel(frame: CGRect(x: 24, y: 60, width: 300, height: 40))
            label.text = title
            label.accessibilityIdentifier = isChild ? "boundary-child-title" : "boundary-root-title"
            surface.addSubview(label)
            if !isChild {
                let button = UIButton(type: .system)
                button.frame = CGRect(x: 24, y: 120, width: 300, height: 48)
                button.setTitle("Open child", for: .normal)
                button.accessibilityIdentifier = "boundary-open-child"
                button.addTarget(self, action: #selector(openChild), for: .touchUpInside)
                surface.addSubview(button)
            }
        }

        override func viewDidLayoutSubviews() {
            super.viewDidLayoutSubviews()
            guard let window = view.window else { return }
            // Use the window inset, not UIKit's bar-adjusted controller inset. The visible bar remains a confound.
            let safe = window.convert(window.safeAreaLayoutGuide.layoutFrame, to: view)
            surface.frame = CGRect(x: 0, y: safe.minY, width: view.bounds.width,
                                   height: view.bounds.maxY - safe.minY)
            surface.contentSize = CGSize(width: surface.bounds.width, height: 1100)
        }

        @objc private func openChild() {
            navigationController?.pushViewController(BoundaryScreen(isChild: true), animated: true)
        }
    }
#endif
