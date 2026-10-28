import SwiftUI

/// Uses the exact web manifest. Only accepted prediction labels select artwork.
struct ScannerOutcomeArtwork: View {
    let group: String
    let label: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floating = false
    private static let groups: [String:[String:String]] = {
        guard let url=Bundle.main.url(forResource:"scanner-artwork",withExtension:"json"),let data=try? Data(contentsOf:url),let root=try? JSONSerialization.jsonObject(with:data) as? [String:Any] else{return[:]}
        return root["groups"] as? [String:[String:String]] ?? [:]
    }()
    var body: some View {
        let id = label.flatMap { Self.groups[group]?[$0] } ?? "uncertain"
        Group {
            if let path=Bundle.main.path(forResource:id,ofType:"png",inDirectory:"ScannerArt"),let image=UIImage(contentsOfFile:path){
                Image(uiImage:image).resizable().scaledToFit()
                    .rotationEffect(.degrees(reduceMotion ? 0 : floating ? -8 : -12))
                    .offset(y:reduceMotion ? 0 : floating ? -4 : 0)
                    .animation(reduceMotion ? nil : .easeInOut(duration:2.1).repeatForever(autoreverses:true),value:floating)
                    .onAppear { floating=true }
            }
        }.frame(width:80,height:80).accessibilityHidden(true)
    }
}
