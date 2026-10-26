import SwiftUI
import Charts

extension Color {
    init(hex: UInt32) { self.init(.sRGB,red:Double((hex>>16)&255)/255,green:Double((hex>>8)&255)/255,blue:Double(hex&255)/255,opacity:1) }
}
enum YF {
    // Cone Code: ink chrome over a stone ground; each material keeps one cone-tube colour.
    static func dynamic(_ light:UInt32,_ dark:UInt32)->Color { Color(uiColor:UIColor{ $0.userInterfaceStyle == .dark ? UIColor(Color(hex:dark)) : UIColor(Color(hex:light)) }) }
    static let rail = Color(hex:0x1d1b19), railInk = Color(hex:0xd8d2ca), railMuted = Color(hex:0xa39b91), railLine = Color(hex:0x34302c), kraft = Color(hex:0xb98a5c)
    static let canvas = dynamic(0xf5f4f2, 0x141312)
    static let surface = dynamic(0xffffff, 0x1f1d1b)
    static let raised = dynamic(0xfafaf9, 0x262321)
    static let ink = Color.primary
    static let muted = dynamic(0x5f5851, 0xb9b2aa)
    static let line = dynamic(0xe5e1db, 0x34302c)
    static let action = dynamic(0x1d1b19, 0xf3f3f1)
    static let onAction = dynamic(0xffffff, 0x1d1b19)
    static let error = dynamic(0xa8201a, 0xffb3aa)
    static let hues:[UInt32] = [0x2f6fd6, 0xc2417f, 0x0f8a8a, 0x4a4540, 0xa4502a, 0x5b6b7a]
    static func hue(_ w:Workspace,_ productId:String)->Color { Color(hex:hues[max(0, w.products.firstIndex{ $0.id == productId } ?? 0) % hues.count]) }
}
/// A cross-wound yarn cone on its kraft tube, wound in the material's colour (same drawing as the web app's Cone).
struct ConeMark:View {
    var hue:Color; var height:CGFloat = 24
    var body:some View { Canvas{ ctx, size in
        let s = size.height / 24
        func p(_ x:CGFloat,_ y:CGFloat)->CGPoint { CGPoint(x:x*s, y:y*s) }
        var tube = Path(); tube.move(to:p(6.3,0.8)); tube.addLine(to:p(9.7,0.8)); tube.addLine(to:p(10.3,5.2)); tube.addLine(to:p(5.7,5.2)); tube.closeSubpath()
        ctx.fill(tube, with:.color(YF.kraft))
        ctx.fill(Path(ellipseIn:CGRect(x:6.3*s, y:0.4*s, width:3.4*s, height:s)), with:.color(Color(hex:0x7d5a38)))
        var lip = Path(); lip.move(to:p(2,20.2)); lip.addQuadCurve(to:p(14,20.2), control:p(8,22.4)); lip.addLine(to:p(13.7,22.1)); lip.addQuadCurve(to:p(2.3,22.1), control:p(8,24.4)); lip.closeSubpath()
        ctx.fill(lip, with:.color(YF.kraft))
        var yarn = Path(); yarn.move(to:p(5.2,4.8)); yarn.addQuadCurve(to:p(10.8,4.8), control:p(8,3.7)); yarn.addLine(to:p(14.2,20.4)); yarn.addQuadCurve(to:p(1.8,20.4), control:p(8,22.6)); yarn.closeSubpath()
        ctx.fill(yarn, with:.color(hue))
        ctx.clip(to:yarn)
        var wind = Path()
        for y in stride(from:CGFloat(2), through:CGFloat(18), by:CGFloat(4)) { wind.move(to:p(-2,y+6)); wind.addLine(to:p(18,y)); wind.move(to:p(-2,y)); wind.addLine(to:p(18,y+6)) }
        ctx.stroke(wind, with:.color(.white.opacity(0.22)), lineWidth:0.45*s)
    }.frame(width:height*2/3, height:height).accessibilityHidden(true) }
}
struct YFButton: ButtonStyle {
    var primary = true
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration:Configuration)->some View { configuration.label.font(.body.weight(.semibold)).frame(maxWidth:.infinity,minHeight:48).padding(.horizontal,16).padding(.vertical,4).background(enabled ? (primary ? YF.action : YF.surface) : YF.raised).foregroundStyle(enabled ? (primary ? YF.onAction : YF.ink) : YF.muted).clipShape(Capsule()).overlay(Capsule().stroke(primary && enabled ? Color.clear : YF.line,lineWidth:1)).scaleEffect(configuration.isPressed ? 0.97 : 1).animation(.easeOut(duration:0.16),value:configuration.isPressed) }
}
// Panels are soft fields with no outline: the screen reads as one flowing surface.
extension View { func panel()->some View { self.padding(22).frame(maxWidth:.infinity,alignment:.leading).background(YF.surface,in:RoundedRectangle(cornerRadius:24,style:.continuous)) } }
struct Brand: View { var inverse=false;var body:some View { HStack(spacing:10){ConeMark(hue:Color(hex:0x2f6fd6),height:34);Text("yarnflow.").font(.title2.bold()).tracking(-0.7).foregroundStyle(inverse ? .white : .primary)}.accessibilityElement(children:.combine) } }
struct StatusBadge:View {let status:String; var body:some View{Label(qualityName(status),systemImage:status=="approved" ? "checkmark.circle" : status=="hold" ? "exclamationmark.triangle" : "list.clipboard").font(.subheadline.weight(.semibold)).foregroundStyle(status=="approved" ? Color(hex:0x1d6b3e) : status=="hold" ? Color(hex:0xa8201a) : Color(hex:0x7f4d00)).padding(.horizontal,12).padding(.vertical,6).background(status=="approved" ? Color(hex:0xe6f3ea) : status=="hold" ? Color(hex:0xfde6e3) : Color(hex:0xfff1d6),in:Capsule())} }
struct SectionTitle:View {let title:String;var subtitle:String?=nil;var body:some View{VStack(alignment:.leading,spacing:7){Text(title).font(.title3.bold());if let subtitle{Text(subtitle).font(.subheadline).foregroundStyle(YF.muted).fixedSize(horizontal:false,vertical:true)}}} }
struct EmptyState:View {let title:String;let message:String;var symbol="shippingbox";var body:some View{VStack(spacing:16){Image(systemName:symbol).font(.largeTitle).foregroundStyle(YF.muted).accessibilityHidden(true);Text(title).font(.title3.bold());Text(message).font(.body).foregroundStyle(YF.muted).multilineTextAlignment(.center)}.frame(maxWidth:.infinity).padding(.vertical,32)} }
@main struct YarnflowApp:App {
    @State private var store=AppStore()
    var body:some Scene{WindowGroup{RootView(store:store).tint(YF.action).preferredColorScheme(store.theme=="dark" ? .dark : store.theme=="system" ? nil : .light).task{
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--review"){store.openReview();if let i=ProcessInfo.processInfo.arguments.firstIndex(of:"--page"),ProcessInfo.processInfo.arguments.count>i+1,let page=AppPage(rawValue:ProcessInfo.processInfo.arguments[i+1]){store.page=page}}
        #endif
    }}}
}
struct RootView:View {
    @Bindable var store:AppStore
    @State private var menu=false
    @Environment(\.horizontalSizeClass) private var size
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body:some View{
        Group{if store.workspace == nil{LoginView(store:store)}else{
            HStack(spacing:0){if size == .regular{Sidebar(store:store,onChoose:{}) .frame(width:280)}
                NavigationStack{WorkspaceScreen(store:store).navigationTitle(store.page.title).navigationBarTitleDisplayMode(.inline).toolbar{if size != .regular{ToolbarItem(placement:.topBarLeading){Button{withAnimation(reduceMotion ? nil : .easeOut(duration:0.2)){menu=true}}label:{Image(systemName:"line.3.horizontal").frame(width:44,height:44)}.accessibilityLabel("Open sidebar")}};ToolbarItem(placement:.topBarTrailing){Button{Task{await store.refresh()}}label:{Image(systemName:"arrow.clockwise").frame(width:44,height:44)}.disabled(store.busy||store.review).accessibilityLabel("Refresh inventory")}}}.accessibilityHidden(menu)
            }.overlay(alignment:.leading){if menu && size != .regular {ZStack(alignment:.leading){Button{menu=false}label:{Color.black.opacity(0.55).ignoresSafeArea()}.accessibilityLabel("Close sidebar");Sidebar(store:store,onChoose:{menu=false}).frame(maxWidth:330).frame(maxWidth:.infinity,alignment:.leading).padding(.trailing,48)}.transition(.move(edge:.leading)).accessibilityAddTraits(.isModal)}}
        }}.onOpenURL{url in if let page=AppPage(rawValue:url.host ?? ""){store.page=page}}
    }
}
struct LoginView:View {
    @Bindable var store:AppStore
    @State private var configure=false
    var body:some View{ScrollView{VStack(spacing:0){VStack(alignment:.leading,spacing:26){Brand(inverse:true);Text("A clearer view.\nA better flow.").font(.largeTitle.bold()).tracking(-1).foregroundStyle(.white);Text("One workspace for the materials, people, and decisions that keep your mill moving.").font(.body).foregroundStyle(YF.railInk).fixedSize(horizontal:false,vertical:true);Label("Built for the mill floor.",systemImage:"square.stack.3d.up").font(.subheadline).foregroundStyle(YF.railMuted)}.frame(maxWidth:.infinity,alignment:.leading).padding(28).padding(.top,16).padding(.bottom,16).background(YF.rail)
        VStack(alignment:.leading,spacing:22){SectionTitle(title:"Welcome to Yarnflow.",subtitle:"Choose how you want to open your workspace.")
            Button{Task{await store.connect()}}label:{HStack{if store.busy{ProgressView()};Text(store.busy ? "Opening workspace…" : "Open local workspace");Image(systemName:"arrow.right")}}.buttonStyle(YFButton()).disabled(store.busy)
            Label("Local development uses an emulated owner account. It is not a production sign-in.",systemImage:"lock.shield").font(.subheadline).foregroundStyle(YF.muted).fixedSize(horizontal:false,vertical:true)
            Button{store.openReview()}label:{Label("Explore design review",systemImage:"sparkle.magnifyingglass")}.buttonStyle(YFButton(primary:false))
            Text("Review mode uses illustrative stock and never writes to your real inventory.").font(.subheadline).foregroundStyle(YF.muted)
            if !store.error.isEmpty{Label(store.error,systemImage:"exclamationmark.triangle").font(.body).foregroundStyle(YF.error).accessibilityAddTraits(.updatesFrequently)}
            DisclosureGroup("Server connection",isExpanded:$configure){VStack(alignment:.leading,spacing:12){Text("Inventory server").font(.body.weight(.medium));TextField("http://127.0.0.1:8788",text:$store.server).textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().padding(14).background(YF.canvas,in:RoundedRectangle(cornerRadius:10));Text("The simulator can reach localhost on this Mac. Hosted authentication must be configured separately for native clients.").font(.subheadline).foregroundStyle(YF.muted)}.padding(.top,12)}.font(.body)
            Text("Traceable stock. Shared decisions. One source of truth.").font(.subheadline).foregroundStyle(YF.muted)
        }.padding(28).frame(maxWidth:600,alignment:.leading)}.frame(maxWidth:.infinity)}.background(YF.surface)}
}
struct Sidebar:View {
    @Bindable var store:AppStore;var onChoose:()->Void
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){HStack{Brand(inverse:true);Spacer();Button{onChoose()}label:{Image(systemName:"xmark").frame(width:44,height:44)}.foregroundStyle(.white).accessibilityLabel("Close sidebar")};VStack(alignment:.leading,spacing:7){Text(store.workspace?.workspace.name ?? "Workspace").font(.headline);Text(store.review ? "Design review · sample data" : "Connected workspace").font(.subheadline).foregroundStyle(YF.railMuted)}.padding(.vertical,14)
        VStack(spacing:5){ForEach(AppPage.allCases){page in Button{store.page=page;onChoose()}label:{HStack(spacing:14){Image(systemName:page.symbol).frame(width:24).accessibilityHidden(true);Text(page.title).font(.body.weight(store.page==page ? .semibold : .regular));Spacer()}.padding(.horizontal,14).padding(.vertical,13).frame(minHeight:48).background(store.page==page ? Color.white : Color.clear,in:Capsule()).foregroundStyle(store.page==page ? YF.rail : YF.railInk)}.accessibilityAddTraits(store.page==page ? .isSelected : [])}}
        Divider().overlay(YF.railLine);VStack(alignment:.leading,spacing:7){Text(store.workspace?.member.name ?? "Owner").font(.headline);Text(store.isOwner ? "Workspace owner" : "Stock operator").font(.subheadline).foregroundStyle(YF.railMuted)};Button{onChoose();store.signOut()}label:{Label("Sign out",systemImage:"rectangle.portrait.and.arrow.right").font(.body).frame(minHeight:48)}.foregroundStyle(YF.railInk)
        }.padding(22).padding(.top,12).foregroundStyle(.white)}.background(YF.rail,ignoresSafeAreaEdges:[]).scrollIndicators(.hidden)}
}
struct WorkspaceScreen:View {
    @Bindable var store:AppStore
    @State private var selected:Batch?
    @State private var action:StockAction?
    @State private var query=""
    @State private var filter="all"
    @Environment(\.dynamicTypeSize) private var textSize
    var filtered:[Batch]{guard let w=store.workspace else{return[]};return w.lots.filter{lot in (query.isEmpty || "\(w.name(lot)) \(lot.batch) \(lot.supplier)".localizedCaseInsensitiveContains(query)) && (filter=="all" || lot.quality==filter) && (store.page != .quality || lot.quality != "approved") && (store.page != .dispatch || lot.quality == "approved") && (store.page != .production || w.grams(lot.id,stage:"wip")>0)}}
    var body:some View{ScrollView{if let w=store.workspace{VStack(alignment:.leading,spacing:24){
        if store.review{Label("Design review · illustrative stock",systemImage:"checkmark.shield").font(.subheadline).foregroundStyle(YF.muted).accessibilityIdentifier("review-banner")}
        if !store.error.isEmpty{Label(store.error,systemImage:"exclamationmark.triangle").foregroundStyle(YF.error).font(.body)}
        if !store.notice.isEmpty{HStack(alignment:.top){Label(store.notice,systemImage:"checkmark.circle").font(.body);Spacer();Button{store.notice=""}label:{Image(systemName:"xmark").frame(width:44,height:44)}.accessibilityLabel("Dismiss message")}.foregroundStyle(YF.action).panel()}
        switch store.page{
        case .overview:dashboard(w)
        case .inventory,.quality,.production,.dispatch:batchList(w)
        case .materials:materials(w)
        case .scanner:NativeScanner(store:store)
        case .activity:activity(w)
        case .reports:reports(w)
        case .team:team(w)
        case .settings:SettingsView(store:store)
        case .help:help
        }
    }.padding(20).frame(maxWidth:1100,alignment:.leading).frame(maxWidth:.infinity)}}.background(YF.canvas).refreshable{await store.refresh()}.sheet(item:$selected){batch in NavigationStack{BatchDetail(store:store,batch:batch)}}.sheet(item:$action){action in ActionForm(store:store,action:action)}.onChange(of:store.page){_,_ in query="";filter="all"}}
    // Home: batches waiting for QC, stock by material (each in its cone colour), then the latest movements.
    func dashboard(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:24){
        VStack(alignment:.leading,spacing:6){Text(w.workspace.name).font(.title2.bold()).tracking(-0.4);Text("Stock by material, batches waiting for QC, and the latest movements.").font(.body).foregroundStyle(YF.muted).fixedSize(horizontal:false,vertical:true)}
        Button{store.page = .scanner}label:{Label("Scan fabric",systemImage:"viewfinder")}.buttonStyle(YFButton())
        qcPanel(w)
        stockPanel(w)
        movesPanel(w)
    }}
    func qcPanel(_ w:Workspace)->some View{
        let waiting=w.lots.filter{$0.quality != "approved"}.sorted{($0.quality=="hold" ? 0 : 1) < ($1.quality=="hold" ? 0 : 1)}
        return VStack(alignment:.leading,spacing:0){
            HStack{Text("Needs QC").font(.title3.bold());Spacer();Text(waiting.count == 1 ? "1 batch" : "\(waiting.count) batches").font(.body).foregroundStyle(YF.muted)}.padding(.bottom,8)
            if waiting.isEmpty{Text("Every batch is QC approved.").font(.body).foregroundStyle(YF.muted).padding(.top,8)}
            ForEach(Array(waiting.prefix(5))){lot in
                Divider()
                Button{selected=lot}label:{HStack(spacing:12){
                    ConeMark(hue:YF.hue(w,lot.productId))
                    VStack(alignment:.leading,spacing:4){Text(w.name(lot)).font(.headline).foregroundStyle(.primary);Text("\(lot.batch) · \(lot.quality == "hold" ? "on QC hold" : "not inspected") · \(kg(w.grams(lot.id))) kg").font(.subheadline).foregroundStyle(YF.muted).monospacedDigit()}
                    Spacer(minLength:8)
                    Text(lot.quality == "hold" ? "Review" : "Inspect").font(.body.weight(.semibold)).foregroundStyle(.primary)
                }.padding(.vertical,12).frame(minHeight:56).contentShape(Rectangle())}.buttonStyle(.plain)
            }
        }.panel()
    }
    func stockPanel(_ w:Workspace)->some View{
        let shares=w.products.map{p in w.lots.filter{$0.productId == p.id}.reduce(0){$0 + w.grams($1.id)}}
        let shown=w.products.indices.filter{shares[$0] > 0}
        return VStack(alignment:.leading,spacing:16){
            HStack{Text("Stock by material").font(.title3.bold());Spacer();Text("\(kg(w.total)) kg").font(.body).foregroundStyle(YF.muted).monospacedDigit()}
            if w.total > 0{
                GeometryReader{geo in HStack(spacing:2){ForEach(shown,id:\.self){i in Rectangle().fill(YF.hue(w,w.products[i].id)).frame(width:max(3,(geo.size.width - CGFloat(2*max(0,shown.count-1))) * CGFloat(shares[i]) / CGFloat(w.total)))}}}
                    .frame(height:10).clipShape(Capsule())
                    .accessibilityElement().accessibilityLabel(shown.map{"\(w.products[$0].name) \(kg(shares[$0])) kilograms"}.joined(separator:", "))
            }
            LazyVGrid(columns:[GridItem(.flexible(),alignment:.topLeading),GridItem(.flexible(),alignment:.topLeading)],alignment:.leading,spacing:16){
                ForEach(stages,id:\.self){stage in VStack(alignment:.leading,spacing:2){Text(stageName(stage)).font(.subheadline).foregroundStyle(YF.muted);Text("\(kg(w.balances.filter{$0.stage == stage}.reduce(0){$0 + $1.grams})) kg").font(.title3.bold()).monospacedDigit()}}
            }
            if w.lots.isEmpty{EmptyState(title:"Start with your first batch",message:"Add a material, create its batch, then receive stock.")}
            ForEach(Array(w.lots.sorted{w.grams($0.id) > w.grams($1.id)}.prefix(6))){lot in Divider();batchRow(lot,w)}
        }.panel()
    }
    func movesPanel(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:0){
        HStack{Text("Recent movements").font(.title3.bold());Spacer();Button("View all"){store.page = .activity}.font(.body.weight(.semibold))}.padding(.bottom,8)
        if w.movements.isEmpty{Text("Movements appear here once stock is received.").font(.body).foregroundStyle(YF.muted).padding(.top,8)}
        ForEach(Array(w.movements.sorted{$0.createdAt > $1.createdAt}.prefix(4))){m in
            Divider()
            HStack(spacing:12){
                ConeMark(hue:YF.hue(w,w.lots.first{$0.id == m.lotId}?.productId ?? ""))
                VStack(alignment:.leading,spacing:4){Text("\(m.action.capitalized) · \(w.batchName(m.lotId))").font(.headline);Text(recordDate(m.createdAt)).font(.subheadline).foregroundStyle(YF.muted)}
                Spacer(minLength:8)
                Text("\(kg(m.grams)) kg").font(.body.weight(.semibold)).monospacedDigit()
            }.padding(.vertical,12)
        }
    }.panel()}
    func stockChart(_ w:Workspace)->some View{let records=Array(w.movements.sorted{$0.createdAt<$1.createdAt}.suffix(14));var running=w.total-records.reduce(0){$0+($1.fromStage==nil ? $1.grams : 0)-($1.toStage==nil ? $1.grams : 0)};let points=records.enumerated().map{index,m in running += (m.fromStage==nil ? m.grams : 0)-(m.toStage==nil ? m.grams : 0);return ChartPoint(index:index,grams:running)}
        return VStack(alignment:.leading,spacing:16){SectionTitle(title:"Stock movement",subtitle:"Recorded movements · weight in kilograms");Text("\(kg(w.total)) kg").font(.title.bold()).monospacedDigit();if points.isEmpty{EmptyState(title:"Your stock story starts here.",message:"Receive stock to see real movement history.")}else{Chart(points){p in AreaMark(x:.value("Record",p.index),y:.value("Stock kg",Double(p.grams)/1000)).foregroundStyle(Color(hex:0x2f6fd6).opacity(0.14));LineMark(x:.value("Record",p.index),y:.value("Stock kg",Double(p.grams)/1000)).foregroundStyle(Color(hex:0x2f6fd6)).lineStyle(StrokeStyle(lineWidth:2.5))}.frame(height:210).chartXAxisLabel("Earlier records → latest").chartYAxisLabel("kg").accessibilityLabel("Recorded stock history ending at \(kg(w.total)) kilograms")}}.panel()
    }
    func batchList(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:store.page == .quality ? "Good stock starts with a good check." : store.page == .dispatch ? "Ready for its next destination." : store.page == .production ? "Move work forward." : "Every batch, in one place.",subtitle:store.page == .dispatch ? "Only approved batches are eligible for dispatch." : "Follow your materials from receipt to dispatch.")
        if store.page == .inventory{Button{action = w.products.isEmpty ? .material : .batch}label:{Label(w.products.isEmpty ? "Add material" : "Create batch",systemImage:"plus")}.buttonStyle(YFButton())}
        HStack{Image(systemName:"magnifyingglass").foregroundStyle(YF.muted).accessibilityHidden(true);TextField("Search material or batch",text:$query).textInputAutocapitalization(.never).accessibilityLabel("Search material or batch")}.padding(14).background(YF.surface,in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).stroke(YF.line,lineWidth:1))
        if store.page == .inventory{Picker("Quality status",selection:$filter){Text("All batches").tag("all");Text("QC approved").tag("approved");Text("Needs inspection").tag("uninspected");Text("QC hold").tag("hold")}.font(.body).pickerStyle(.menu).frame(minHeight:44)}
        VStack(spacing:0){if filtered.isEmpty{EmptyState(title:"No matching batches",message:"Try another search, or add a material and create a batch.")}else{ForEach(filtered){lot in batchRow(lot,w);if lot.id != filtered.last?.id{Divider().padding(.vertical,8)}}}}.panel()
    }}
    func batchRow(_ lot:Batch,_ w:Workspace)->some View{Button{selected=lot}label:{VStack(alignment:.leading,spacing:12){HStack(alignment:.top,spacing:12){ConeMark(hue:YF.hue(w,lot.productId)).padding(.top,2);VStack(alignment:.leading,spacing:7){Text(w.name(lot)).font(.headline).foregroundStyle(.primary).multilineTextAlignment(.leading);Text(lot.batch).font(.subheadline).foregroundStyle(YF.muted)};Spacer(minLength:8);Text("\(kg(w.grams(lot.id))) kg").font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.primary).multilineTextAlignment(.trailing)};StatusBadge(status:lot.quality)}.padding(.vertical,12).frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.plain).accessibilityHint("Opens batch details and stock actions")}
    func materials(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"Material catalogue",subtitle:"Specifications, SKUs, and batch traceability.");if store.isOwner{Button{action = .material}label:{Label("Add material",systemImage:"plus")}.buttonStyle(YFButton())};ForEach(w.products){p in VStack(alignment:.leading,spacing:12){Label(p.name,systemImage:"cube").font(.headline);Text(p.sku).font(.body).foregroundStyle(YF.muted);Text("\(w.lots.filter{$0.productId==p.id}.count) batches").font(.subheadline).foregroundStyle(YF.muted)}.panel()};if w.products.isEmpty{EmptyState(title:"Your materials belong here.",message:"Add a material to start receiving stock.")}}}
    func activity(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"Every move has a story.",subtitle:"Original records remain traceable.");if w.movements.isEmpty{EmptyState(title:"No movements yet",message:"Receive stock into a batch to start the audit history.")};ForEach(w.movements){m in VStack(alignment:.leading,spacing:12){Label(m.action.capitalized,systemImage:m.action=="receive" ? "arrow.down.left" : m.action=="dispatch" ? "truck.box" : "arrow.left.arrow.right").font(.headline);Text("\(w.batchName(m.lotId)) · \(kg(m.grams)) kg").font(.body).monospacedDigit();Text("\(m.fromStage.map(stageName) ?? "External") → \(m.toStage.map(stageName) ?? "External")").font(.body).foregroundStyle(YF.muted);if !m.note.isEmpty{Text(m.note).font(.body)};Text("\(m.actorName) · \(recordDate(m.createdAt))").font(.subheadline).foregroundStyle(YF.muted)}.panel()}}}
    func reports(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:24){SectionTitle(title:"A little perspective.",subtitle:"Summaries from recorded stock, never estimates.");stockChart(w);VStack(alignment:.leading,spacing:18){Text("Workspace summary").font(.title3.bold());FactRow("Stock on hand","\(kg(w.total)) kg");FactRow("Materials","\(w.products.count)");FactRow("Batches","\(w.lots.count)");FactRow("QC holds","\(w.lots.filter{$0.quality=="hold"}.count)");Text("Complete JSON backups are available in the web app’s Reports page.").font(.body).foregroundStyle(YF.muted)}.panel()}}
    func team(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"People & access",subtitle:"The right decisions, in the right hands.");ForEach(Array(w.members.enumerated()),id:\.offset){_,m in VStack(alignment:.leading,spacing:10){Label(m.name,systemImage:"person.crop.circle").font(.headline);Text(m.role=="owner" ? "Owner · QC approval and invites" : "Operator · stock and inspections").font(.body).foregroundStyle(YF.muted)}.panel()};Text("Create single-use team invites from People & access in the web app. Site access is separate from workspace membership.").font(.body).foregroundStyle(YF.muted)}}
    var help:some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"A little guidance, a smoother day.");ForEach([("Receive stock","Add a material, create its batch, then choose Receive stock. Review every quantity before saving."),("Quality approval","Inspect the physical material and record the reason. Only an owner can release a QC hold."),("Correct an entry","Use the web activity register to reverse a movement with a reason. Original records stay visible."),("Camera & privacy","Photos stay on your device until you explicitly send an inspection to the model. An uncertain result stays uncertain."),("Your data","Review mode stays in memory and is cleared on sign-out. Connected mode uses your server ledger. A connection failure never substitutes sample stock.")],id:\.0){title,text in DisclosureGroup(title){Text(text).font(.body).foregroundStyle(YF.muted).padding(.top,12)}.font(.headline).panel()}}}
}
struct ChartPoint:Identifiable{let index:Int;let grams:Int;var id:Int{index}}

struct FactRow:View { let title:String;let value:String;init(_ title:String,_ value:String){self.title=title;self.value=value};var body:some View{LabeledContent(title,value:value).font(.body)} }
