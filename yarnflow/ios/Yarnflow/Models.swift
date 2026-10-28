import SwiftUI
import Observation

struct Mill: Codable { var id: String; var name: String }
struct Member: Codable { var name: String; var role: String }
struct Material: Codable, Identifiable, Hashable { var id: String; var sku: String; var name: String; var barcode: String? }
struct Batch: Codable, Identifiable, Hashable { var id: String; var productId: String; var batch: String; var supplier: String; var quality: String; var createdAt: Double }
struct Balance: Codable { var lotId: String; var stage: String; var grams: Int; var cartons: Int; var cones: Int }
struct Movement: Codable, Identifiable { var id: String; var lotId: String; var action: String; var fromStage: String?; var toStage: String?; var grams: Int; var note: String; var actorName: String; var createdAt: Double; var reverses: String? }
struct Inspection: Codable, Identifiable { var id: String; var lotId: String; var labelText: String; var note: String; var source: String; var actorName: String; var createdAt: Double }
struct QualityEvent: Codable, Identifiable { var id: String; var lotId: String; var status: String; var note: String; var actorName: String; var createdAt: Double }
struct Workspace: Codable {
    var workspace: Mill; var member: Member; var products: [Material]; var lots: [Batch]; var balances: [Balance]; var movements: [Movement]; var members: [Member]; var inspections: [Inspection]; var qualityEvents: [QualityEvent]
    var total: Int { balances.reduce(0) { $0 + $1.grams } }
    func grams(_ id: String, stage: String? = nil) -> Int { balances.filter { $0.lotId == id && (stage == nil || $0.stage == stage) }.reduce(0) { $0 + $1.grams } }
    func name(_ batch: Batch) -> String { products.first { $0.id == batch.productId }?.name ?? "Material" }
    func batchName(_ id: String) -> String { lots.first { $0.id == id }?.batch ?? "Batch" }
    static var sample: Workspace {
        let now = Date().timeIntervalSince1970 * 1000
        let products = [("Compact cotton", "CTN-30", "Ne 30/1"), ("PC blend yarn", "PC-26", "65/35"), ("Carded cotton", "CTN-20", "Ne 20/1"), ("Indigo denim", "DNM-31", "3/1 twill"), ("Polyester yarn", "PES-40", "Ne 40/1"), ("Viscose yarn", "VIS-30", "Ne 30/1")].map { Material(id: UUID().uuidString, sku: $0.1, name: "\($0.0) · \($0.2)", barcode: nil) }
        let qualities = ["approved", "approved", "uninspected", "hold", "approved", "uninspected"]
        let stages = ["raw", "raw", "wip", "wip", "finished", "finished"]
        let amounts = [8250000,5950000,4100000,3350000,2000000,1200000]
        let lots = products.enumerated().map { Batch(id: UUID().uuidString, productId: $0.element.id, batch: "LOT-\(1024-$0.offset)", supplier: $0.offset % 2 == 0 ? "Crescent Cotton Co." : "Indus Textile Mills", quality: qualities[$0.offset], createdAt: now - Double($0.offset * 3600000)) }
        let balances = lots.enumerated().map { Balance(lotId: $0.element.id, stage: stages[$0.offset], grams: amounts[$0.offset], cartons: 20, cones: 480) }
        let movements = lots.enumerated().map { Movement(id: UUID().uuidString, lotId: $0.element.id, action: "receive", fromStage: nil, toStage: stages[$0.offset], grams: amounts[$0.offset], note: "Illustrative receipt for design review", actorName: "Review owner", createdAt: now - Double((6-$0.offset)*3600000), reverses: nil) }.reversed()
        return Workspace(workspace: Mill(id:"review", name:"Crescent Yarn Mills"),member:Member(name:"Zuhair Merchant",role:"owner"),products:products,lots:lots,balances:balances,movements:Array(movements),members:[Member(name:"Zuhair Merchant",role:"owner"),Member(name:"Ayesha Khan",role:"operator")],inspections:[],qualityEvents:[])
    }
}
let stages = ["raw", "wip", "finished", "cops"]
func stageName(_ value: String) -> String { ["raw":"Raw material","wip":"Work in progress","finished":"Finished stock","cops":"Cops"][value] ?? value }
func qualityName(_ value: String) -> String { ["approved":"QC approved","hold":"QC hold","uninspected":"Needs inspection"][value] ?? value }
func kg(_ value: Int) -> String { (Double(value)/1000).formatted(.number.precision(.fractionLength(0...3))) }
func recordDate(_ value: Double) -> String { let formatter = DateFormatter(); formatter.timeZone = TimeZone(identifier:"Asia/Karachi"); formatter.dateStyle = .medium; formatter.timeStyle = .short; return formatter.string(from: Date(timeIntervalSince1970:value/1000)) }
enum AppPage: String, CaseIterable, Identifiable {
    case overview, inventory, materials, production, dispatch, quality, scanner, activity, reports, team, settings, help
    var id: String { rawValue }
    var title: String { switch self { case .overview: "Overview"; case .inventory: "Inventory"; case .materials: "Materials"; case .production: "Production"; case .dispatch: "Dispatch"; case .quality: "Quality checks"; case .scanner: "Material scanner"; case .activity: "Activity log"; case .reports: "Reports"; case .team: "People & access"; case .settings: "Settings"; case .help: "Help & privacy" } }
    var symbol: String { switch self { case .overview: "square.grid.2x2"; case .inventory: "shippingbox"; case .materials: "cube"; case .production: "building.2"; case .dispatch: "truck.box"; case .quality: "checkmark.shield"; case .scanner: "viewfinder"; case .activity: "clock.arrow.circlepath"; case .reports: "chart.xyaxis.line"; case .team: "person.2"; case .settings: "slider.horizontal.3"; case .help: "questionmark.circle" } }
}
enum StockAction: String, Identifiable { case material, batch, receive, transfer, dispatch, quality, inspection, waste
    var id: String { rawValue }
    var title: String { switch self { case .material:"Add material"; case .batch:"Create batch"; case .receive:"Receive stock"; case .transfer:"Move stock"; case .dispatch:"Dispatch stock"; case .quality:"Review quality"; case .inspection:"Record inspection"; case .waste:"Record waste" } }
}
struct Draft {
    var id = UUID().uuidString.lowercased(); var name = ""; var sku = ""; var batch = ""; var supplier = ""; var productId = ""; var lotId = ""; var amount = ""; var stage = "raw"; var toStage = "wip"; var quality = "approved"; var note = ""; var label = ""
}
enum ServiceError: LocalizedError { case message(String); var errorDescription: String? { switch self {case .message(let text):text} } }
@MainActor @Observable final class AppStore {
    var workspace: Workspace?; var review = false; var busy = false; var error = ""; var notice = ""; var page = AppPage.overview
    var server = UserDefaults.standard.string(forKey:"yf-server") ?? "http://127.0.0.1:8788"
    var modelServer = UserDefaults.standard.string(forKey:"yf-model") ?? "http://127.0.0.1:8000"
    var theme = UserDefaults.standard.string(forKey:"yf-theme") ?? "light"
    var isOwner: Bool { workspace?.member.role == "owner" }
    func request(_ path: String, data: [String:Any]? = nil) async throws -> Data {
        guard let base = URL(string:server), base.scheme == "https" || (["127.0.0.1","localhost"].contains(base.host ?? "") && base.scheme == "http") else { throw ServiceError.message("Use an HTTPS server address, or localhost for development.") }
        guard let url = URL(string:server.trimmingCharacters(in:.init(charactersIn:"/")) + "/api" + path) else { throw ServiceError.message("Enter a valid server address.") }
        var request = URLRequest(url:url); request.timeoutInterval = 20; request.cachePolicy = .reloadIgnoringLocalCacheData
        if let data { request.httpMethod="POST"; request.setValue("application/json",forHTTPHeaderField:"Content-Type"); request.setValue("\(base.scheme!)://\(base.host!)\(base.port.map{ ":\($0)" } ?? "")",forHTTPHeaderField:"Origin"); request.httpBody=try JSONSerialization.data(withJSONObject:data) }
        let (body,response)=try await URLSession.shared.data(for:request)
        guard let http=response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { let object=try? JSONSerialization.jsonObject(with:body) as? [String:Any]; throw ServiceError.message(object?["error"] as? String ?? "The server did not confirm the request. Check your connection and account access.") }
        return body
    }
    func connect() async { busy=true;error="";defer{busy=false}; do { let data=try await request("/workspace"); let decoder=JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase; workspace=try decoder.decode(Workspace.self,from:data); review=false;UserDefaults.standard.set(server,forKey:"yf-server") } catch { self.error="Could not open this workspace. \(error.localizedDescription)" } }
    func openReview() { workspace = .sample; review=true; error="";page = .overview }
    func refresh() async { guard !review else{return}; await connect() }
    func signOut() { workspace=nil;error="";notice="";review=false;page = .overview;HTTPCookieStorage.shared.removeCookies(since:.distantPast) }
    func save(_ action: StockAction, draft: Draft) async throws {
        guard var w=workspace else{return}
        var data:[String:Any]=[:]; var endpoint=""
        if action == .material { guard draft.name.trimmingCharacters(in:.whitespaces).count>=2,!draft.sku.isEmpty else {throw ServiceError.message("Enter a material name and SKU.")}; endpoint="/products";data=["name":draft.name,"sku":draft.sku,"barcode":""] }
        else if action == .batch { guard !draft.productId.isEmpty,!draft.batch.isEmpty else{throw ServiceError.message("Choose a material and enter the batch number.")};endpoint="/lots";data=["productId":draft.productId,"batch":draft.batch,"supplier":draft.supplier] }
        else { guard let lot=w.lots.first(where:{$0.id==draft.lotId}) else{throw ServiceError.message("Choose a batch.")}
            if action == .quality { guard draft.note.trimmingCharacters(in:.whitespaces).count>=3 else{throw ServiceError.message("Record the physical inspection reason.")}; endpoint="/quality";data=["lotId":draft.lotId,"status":draft.quality,"note":draft.note] }
            else if action == .inspection { guard draft.note.count>=3 else{throw ServiceError.message("Enter an inspection note of at least three characters.")};endpoint="/inspections";data=["id":draft.id,"lotId":draft.lotId,"labelText":draft.label,"note":draft.note] }
            else { guard draft.amount.range(of:"^\\d+(\\.\\d{1,3})?$",options:.regularExpression) != nil, let amount=Double(draft.amount), amount>0,amount<=9000000000 else{throw ServiceError.message("Enter a positive weight with up to three decimal places.")}; let grams=Int((amount*1000).rounded())
                if action == .dispatch && lot.quality != "approved" {throw ServiceError.message("This batch needs owner QC approval before dispatch.")}
                if action != .receive && w.grams(lot.id,stage:draft.stage)<grams {throw ServiceError.message("There is not enough stock in this stage.")}
                if action == .transfer && draft.stage==draft.toStage {throw ServiceError.message("Choose different source and destination stages.")}
                endpoint="/movements"; data=["id":draft.id,"lotId":lot.id,"action":action.rawValue,"stage":draft.stage,"grams":grams,"cartons":0,"cones":0,"note":draft.note];if action == .transfer{data["toStage"]=draft.toStage}
            }
        }
        if !review { _=try await request(endpoint,data:data); await refresh(); if !error.isEmpty {throw ServiceError.message("Saved, but refresh failed. Retry refresh before another entry.")};notice="Saved to your shared workspace.";return }
        if action == .material {w.products.append(Material(id:draft.id,sku:draft.sku,name:draft.name,barcode:nil))}
        else if action == .batch {w.lots.insert(Batch(id:draft.id,productId:draft.productId,batch:draft.batch,supplier:draft.supplier,quality:"uninspected",createdAt:Date().timeIntervalSince1970*1000),at:0)}
        else if action == .quality {if let i=w.lots.firstIndex(where:{$0.id==draft.lotId}){w.lots[i].quality=draft.quality};w.qualityEvents.insert(QualityEvent(id:draft.id,lotId:draft.lotId,status:draft.quality,note:draft.note,actorName:w.member.name,createdAt:Date().timeIntervalSince1970*1000),at:0)}
        else if action == .inspection {w.inspections.insert(Inspection(id:draft.id,lotId:draft.lotId,labelText:draft.label,note:draft.note,source:"manual",actorName:w.member.name,createdAt:Date().timeIntervalSince1970*1000),at:0)}
        else {let grams=data["grams"] as! Int;let from=action == .receive ? nil : draft.stage;let to=action == .receive ? draft.stage : action == .transfer ? draft.toStage : nil
            for (stage,sign) in [(from,-1),(to,1)] {if let stage {if let i=w.balances.firstIndex(where:{$0.lotId==draft.lotId && $0.stage==stage}){w.balances[i].grams += sign*grams}else{w.balances.append(Balance(lotId:draft.lotId,stage:stage,grams:sign*grams,cartons:0,cones:0))}}}
            w.movements.insert(Movement(id:draft.id,lotId:draft.lotId,action:action.rawValue,fromStage:from,toStage:to,grams:grams,note:draft.note,actorName:w.member.name,createdAt:Date().timeIntervalSince1970*1000,reverses:nil),at:0)
        }; workspace=w;notice="Saved in review mode. Your real stock is unchanged."
    }
}
