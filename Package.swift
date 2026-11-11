// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NewYork3",
    platforms: [.macOS(.v14), .iOS(.v17)],
    // The app's own Swift in Sources/, and Lamp's beside what it builds (`GameKit.lampSwiftFolder`).
    targets: [.executableTarget(name: "NewYork3", path: ".", sources: ["Sources", "build/lamp-swift"])]
)
