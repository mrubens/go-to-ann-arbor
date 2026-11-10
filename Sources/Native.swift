import Foundation
import AVFoundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// What the page asks of this Mac, iPhone or iPad with `LampNative.call(name, args)` in Web/: the person's own things
/// the page can't reach itself (mail, calendar, reminders, contacts, photos, location…), read with Lamp's building
/// blocks in LampSupport.swift. Each call is registered here once, as the app opens.
enum Native {
    /// The one page the badge's GitHub link may open, in the person's browser
    static let repo = URL(string: "https://github.com/mrubens/go-to-ann-arbor")!
    static let feedHosts: Set<String> = ["rt.theride.org", "opensky-network.org", "gbfs.spin.pm", "mdotjboss.state.mi.us"]

    @MainActor static func register() {
        LampNative.on("openRepo") { _ in
            #if os(macOS)
            NSWorkspace.shared.open(repo)
            #else
            await UIApplication.shared.open(repo)
            #endif
            return true
        }
        /// A live public feed the page can't read itself (its server doesn't let a page ask): TheRide's bus positions,
        /// OpenSky's aircraft, Spin's scooters and MDOT's highway work. Only these hosts; the body comes back as base64.
        LampNative.on("feed") { args in
            guard let text = args["url"] as? String, let url = URL(string: text), url.scheme == "https",
                  let host = url.host, feedHosts.contains(host) else { throw LampNative.Failure("not a feed") }
            // MDOT's list is asked for as the city opens, and the page waits only a few seconds for it: given up on
            // sooner than the others, and not handed on whole should its server send far more than a list
            let mdot = host == "mdotjboss.state.mi.us"
            var request = URLRequest(url: url, timeoutInterval: mdot ? 8 : 20)
            request.setValue("GoToAnnArbor/1.0", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw LampNative.Failure("status \((response as? HTTPURLResponse)?.statusCode ?? 0)")
            }
            if mdot && data.count > 8 << 20 { throw LampNative.Failure("too big") }
            return data.base64EncodedString()
        }
        /// Recording mode: a video of the drive, sent from the page a second at a time and written into
        /// Movies/Go To Ann Arbor (the iPhone's or iPad's Files, in the app's folder), then shown in Finder on the Mac
        LampNative.on("videoStart") { args in
            let ext = (args["ext"] as? String) == "webm" ? "webm" : "mp4"
            Recording.handle?.closeFile()
            #if os(macOS)
            let base = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask)[0]
            #else
            let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            #endif
            let folder = base.appendingPathComponent("Go To Ann Arbor", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let stamp = DateFormatter()
            stamp.dateFormat = "yyyy-MM-dd 'at' h.mm.ss a"
            let url = folder.appendingPathComponent("Ann Arbor \(stamp.string(from: Date())).\(ext)")
            FileManager.default.createFile(atPath: url.path, contents: nil)
            Recording.handle = try FileHandle(forWritingTo: url)
            Recording.url = url
            return url.lastPathComponent
        }
        LampNative.on("videoChunk") { args in
            guard let text = args["data"] as? String, let data = Data(base64Encoded: text), let handle = Recording.handle
            else { throw LampNative.Failure("no recording") }
            try handle.write(contentsOf: data)
            return true
        }
        LampNative.on("videoEnd") { _ in
            guard let url = Recording.url else { throw LampNative.Failure("no recording") }
            try Recording.handle?.close()
            Recording.handle = nil
            Recording.url = nil
            #if os(macOS)
            NSWorkspace.shared.activateFileViewerSelecting([url])
            #endif
            return url.lastPathComponent
        }
        /// The car radio: a local station's live stream, played here (the page's sound can't play a live stream).
        /// Only the stations' own stream hosts.
        LampNative.on("radioPlay") { args in
            guard let text = args["url"] as? String, let url = URL(string: text), url.scheme == "https",
                  let host = url.host, Radio.allows(host) else { throw LampNative.Failure("not a station") }
            Radio.play(url, volume: Float(args["volume"] as? Double ?? 0.6))
            return true
        }
        LampNative.on("radioStop") { _ in
            Radio.stop()
            return true
        }
        LampNative.on("radioVolume") { args in
            Radio.player?.volume = Float(args["volume"] as? Double ?? 0.6)
            return true
        }
        /// What the station says is on now (its stream's title), or ""
        LampNative.on("radioNow") { _ in
            Radio.title
        }
        /// How the stream is doing: "playing", "waiting" (starting, or filling up again) or "failed" (it couldn't start,
        /// or stopped: the network gone, the Mac asleep, the station refusing); the page starts a failed one again
        LampNative.on("radioState") { _ in
            Radio.state
        }
        /// How much memory this device has, in gigabytes: the page builds less of the city on one with 16 GB or less
        LampNative.on("memory") { _ in
            Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824
        }
    }
}

/// The video being written while the page records
@MainActor enum Recording {
    static var handle: FileHandle?
    static var url: URL?
}

/// The car radio's one live stream
@MainActor enum Radio {
    static var player: AVPlayer?
    static var title = ""
    private static var reader: TitleReader?

    static func allows(_ host: String) -> Bool {
        host == "playerservices.streamtheworld.com" || host.hasSuffix(".live.streamtheworld.com") || host == "floyd.wcbn.org"
    }

    static func play(_ url: URL, volume: Float) {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        stop()
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": ["User-Agent": "GoToAnnArbor/1.0"]])
        let item = AVPlayerItem(asset: asset)
        let reader = TitleReader()
        let output = AVPlayerItemMetadataOutput(identifiers: nil)
        output.setDelegate(reader, queue: .main)
        item.add(output)
        self.reader = reader
        let player = AVPlayer(playerItem: item)
        player.volume = volume
        player.automaticallyWaitsToMinimizeStalling = true
        player.play()
        self.player = player
    }

    static var state: String {
        guard let player else { return "waiting" }
        if player.status == .failed || player.currentItem?.status == .failed || player.currentItem == nil { return "failed" }
        switch player.timeControlStatus {
        case .playing: return "playing"
        case .waitingToPlayAtSpecifiedRate: return "waiting"
        // (asked to play, so stopped on its own: a live stream that ended or dropped)
        case .paused: return "failed"
        @unknown default: return "waiting"
        }
    }

    static func stop() {
        player?.pause()
        player?.replaceCurrentItem(with: nil)
        player = nil
        reader = nil
        title = ""
    }
}

/// Reads the stream's titles as they come (StreamTheWorld and Icecast send "Artist - Song" between songs)
final class TitleReader: NSObject, AVPlayerItemMetadataOutputPushDelegate {
    func metadataOutput(_ output: AVPlayerItemMetadataOutput, didOutputTimedMetadataGroups groups: [AVTimedMetadataGroup],
                        from track: AVPlayerItemTrack?) {
        for item in groups.flatMap(\.items) where item.commonKey == .commonKeyTitle || item.identifier?.rawValue.contains("StreamTitle") == true {
            guard let text = item.stringValue?.trimmingCharacters(in: .whitespaces) else { continue }
            Task { @MainActor in Radio.title = text }
        }
    }
}
