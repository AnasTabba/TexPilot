import SwiftUI
import Charts

extension Color {
    init(hex: UInt32) { self.init(.sRGB,red:Double((hex>>16)&255)/255,green:Double((hex>>8)&255)/255,blue:Double(hex&255)/255,opacity:1) }
}
enum YF {
    static let lime = Color(hex:0xd0ed82), charcoal = Color(hex:0x252720), onLime = Color(hex:0x26331b)
    static let canvas = Color(uiColor:UIColor{ $0.userInterfaceStyle == .dark ? UIColor(red:0.09,green:0.11,blue:0.08,alpha:1) : UIColor(red:0.96,green:0.965,blue:0.95,alpha:1) })
    static let surface = Color(uiColor:.secondarySystemGroupedBackground)
    static let ink = Color.primary
    static let muted = Color(uiColor:UIColor{ $0.userInterfaceStyle == .dark ? UIColor(red:0.77,green:0.82,blue:0.70,alpha:1) : UIColor(red:0.38,green:0.43,blue:0.33,alpha:1) })
    static let line = Color(uiColor:UIColor{ $0.userInterfaceStyle == .dark ? UIColor(white:0.31,alpha:1) : UIColor(red:0.89,green:0.91,blue:0.86,alpha:1) })
    static let action = Color(uiColor:UIColor{ $0.userInterfaceStyle == .dark ? UIColor(red:0.82,green:0.93,blue:0.51,alpha:1) : UIColor(red:0.29,green:0.39,blue:0.17,alpha:1) })
}
struct YFButton: ButtonStyle {
    var primary = true
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration:Configuration)->some View { configuration.label.font(.body.weight(.semibold)).frame(maxWidth:.infinity,minHeight:48).padding(.horizontal,16).padding(.vertical,4).background(primary ? YF.lime : YF.surface).foregroundStyle(primary ? YF.onLime : YF.action).clipShape(RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).stroke(primary ? Color.clear : YF.line,lineWidth:1)).opacity(enabled ? (configuration.isPressed ? 0.75 : 1) : 0.45) }
}
extension View { func panel()->some View { self.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(YF.surface).clipShape(RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(YF.line,lineWidth:1)) } }
struct Brand: View { var inverse=false;var body:some View { HStack(spacing:10){Image("BrandLogo").resizable().scaledToFit().frame(width:44,height:44).accessibilityHidden(true);Text("yarnflow.").font(.title2.bold()).tracking(-0.7).foregroundStyle(inverse ? .white : .primary)}.accessibilityElement(children:.combine) } }
struct StatusBadge:View {let status:String; var body:some View{Label(qualityName(status),systemImage:status=="approved" ? "checkmark.shield" : status=="hold" ? "pause.circle" : "clock").font(.subheadline.weight(.medium)).foregroundStyle(status=="approved" ? Color(hex:0x49672e) : status=="hold" ? Color(hex:0x8b4935) : Color(hex:0x80591c)).padding(.horizontal,10).padding(.vertical,7).background(status=="approved" ? Color(hex:0xedf4e5) : status=="hold" ? Color(hex:0xfceee9) : Color(hex:0xfcf3e3),in:RoundedRectangle(cornerRadius:8))} }
struct SectionTitle:View {let title:String;var subtitle:String?=nil;var body:some View{VStack(alignment:.leading,spacing:7){Text(title).font(.title3.bold());if let subtitle{Text(subtitle).font(.subheadline).foregroundStyle(YF.muted).fixedSize(horizontal:false,vertical:true)}}} }
struct EmptyState:View {let title:String;let message:String;var symbol="shippingbox";var body:some View{VStack(spacing:16){Image(systemName:symbol).font(.largeTitle).foregroundStyle(YF.action).accessibilityHidden(true);Text(title).font(.title3.bold());Text(message).font(.body).foregroundStyle(YF.muted).multilineTextAlignment(.center)}.frame(maxWidth:.infinity).padding(.vertical,32)} }
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
    var body:some View{ScrollView{VStack(spacing:0){VStack(alignment:.leading,spacing:26){Brand(inverse:true);Text("A clearer view.\nA better flow.").font(.largeTitle.bold()).tracking(-1).foregroundStyle(.white);Text("One workspace for the materials, people, and decisions that keep your mill moving.").font(.body).foregroundStyle(Color(hex:0xc5d1b8)).fixedSize(horizontal:false,vertical:true);Label("Built for the mill floor.",systemImage:"square.stack.3d.up").font(.subheadline).foregroundStyle(YF.lime)}.frame(maxWidth:.infinity,alignment:.leading).padding(28).padding(.top,16).padding(.bottom,16).background(YF.charcoal)
        VStack(alignment:.leading,spacing:22){SectionTitle(title:"Welcome to Yarnflow.",subtitle:"Choose how you want to open your workspace.")
            Button{Task{await store.connect()}}label:{HStack{if store.busy{ProgressView()};Text(store.busy ? "Opening workspace…" : "Open local workspace");Image(systemName:"arrow.right")}}.buttonStyle(YFButton()).disabled(store.busy)
            Label("Local development uses an emulated owner account. It is not a production sign-in.",systemImage:"lock.shield").font(.subheadline).foregroundStyle(YF.muted).fixedSize(horizontal:false,vertical:true)
            Button{store.openReview()}label:{Label("Explore design review",systemImage:"sparkle.magnifyingglass")}.buttonStyle(YFButton(primary:false))
            Text("Review mode uses illustrative stock and never writes to your real inventory.").font(.subheadline).foregroundStyle(YF.muted)
            if !store.error.isEmpty{Label(store.error,systemImage:"exclamationmark.triangle").font(.body).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently)}
            DisclosureGroup("Server connection",isExpanded:$configure){VStack(alignment:.leading,spacing:12){Text("Inventory server").font(.body.weight(.medium));TextField("http://127.0.0.1:8788",text:$store.server).textContentType(.URL).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().padding(14).background(YF.canvas,in:RoundedRectangle(cornerRadius:10));Text("The simulator can reach localhost on this Mac. Hosted authentication must be configured separately for native clients.").font(.subheadline).foregroundStyle(YF.muted)}.padding(.top,12)}.font(.body)
            Text("Traceable stock. Shared decisions. One source of truth.").font(.subheadline).foregroundStyle(YF.muted)
        }.padding(28).frame(maxWidth:600,alignment:.leading)}.frame(maxWidth:.infinity)}.background(YF.surface)}
}
struct Sidebar:View {
    @Bindable var store:AppStore;var onChoose:()->Void
    var body:some View{ScrollView{VStack(alignment:.leading,spacing:24){HStack{Brand(inverse:true);Spacer();Button{onChoose()}label:{Image(systemName:"xmark").frame(width:44,height:44)}.foregroundStyle(.white).accessibilityLabel("Close sidebar")};VStack(alignment:.leading,spacing:7){Text(store.workspace?.workspace.name ?? "Workspace").font(.headline);Text(store.review ? "Design review · sample data" : "Connected workspace").font(.subheadline).foregroundStyle(Color(hex:0xc5d1b8))}.padding(.vertical,14)
        VStack(spacing:5){ForEach(AppPage.allCases){page in Button{store.page=page;onChoose()}label:{HStack(spacing:14){Image(systemName:page.symbol).frame(width:24).accessibilityHidden(true);Text(page.title).font(.body.weight(store.page==page ? .semibold : .regular));Spacer()}.padding(.horizontal,14).padding(.vertical,13).frame(minHeight:48).background(store.page==page ? YF.lime : .clear,in:RoundedRectangle(cornerRadius:10)).foregroundStyle(store.page==page ? YF.onLime : Color(hex:0xd1dac4))}.accessibilityAddTraits(store.page==page ? .isSelected : [])}}
        Divider().overlay(Color(hex:0x4a543f));VStack(alignment:.leading,spacing:7){Text(store.workspace?.member.name ?? "Owner").font(.headline);Text(store.isOwner ? "Workspace owner" : "Stock operator").font(.subheadline).foregroundStyle(Color(hex:0xc5d1b8))};Button{onChoose();store.signOut()}label:{Label("Sign out",systemImage:"rectangle.portrait.and.arrow.right").font(.body).frame(minHeight:48)}.foregroundStyle(Color(hex:0xd1dac4))
        }.padding(22).padding(.top,12).foregroundStyle(.white)}.background(YF.charcoal,ignoresSafeAreaEdges:[]).scrollIndicators(.hidden)}
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
        if !store.error.isEmpty{Label(store.error,systemImage:"exclamationmark.triangle").foregroundStyle(.red).font(.body)}
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
    func dashboard(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:24){VStack(alignment:.leading,spacing:10){Text("A clear view of your mill.").font(.title.bold()).tracking(-0.7);Text("Here’s how your stock is moving today.").font(.body).foregroundStyle(YF.muted)}
        LazyVGrid(columns:Array(repeating:GridItem(.flexible(),alignment:.top),count:textSize.isAccessibilitySize ? 1 : 2),spacing:14){metric("Total stock on hand",kg(w.total),"kg","shippingbox",featured:true);metric("Active batches",String(w.lots.count),"lots","square.stack.3d.up");metric("QC-approved stock",kg(w.balances.filter{b in w.lots.contains{$0.id==b.lotId && $0.quality=="approved"}}.reduce(0){$0+$1.grams}),"kg","truck.box");metric("Needs attention",String(w.lots.filter{$0.quality != "approved"}.count),"batches","checkmark.shield")}
        stockChart(w)
        VStack(alignment:.leading,spacing:24){SectionTitle(title:"Stock by stage",subtitle:"From arrival to ready.");ForEach(stages,id:\.self){stage in let amount=w.balances.filter{$0.stage==stage}.reduce(0){$0+$1.grams};VStack(alignment:.leading,spacing:10){HStack{Text(stageName(stage)).font(.body);Spacer();Text("\(kg(amount)) kg").font(.body.weight(.semibold)).monospacedDigit()};ProgressView(value:Double(amount),total:Double(max(1,w.total))).tint(stage=="raw" ? Color(hex:0x91ad4e) : YF.action)}}}.panel()
        Button{store.page = .scanner}label:{HStack(alignment:.top,spacing:14){Image(systemName:"viewfinder").font(.title).accessibilityHidden(true);VStack(alignment:.leading,spacing:8){Text("Know your fabric.").font(.headline);Text("Inspect the surface. Read the label. Preserve the evidence.").font(.body)};Spacer();Image(systemName:"arrow.up.right")}}.buttonStyle(YFButton(primary:false))
        VStack(alignment:.leading,spacing:18){HStack{Text("Recent batches").font(.title3.bold());Spacer();Button("View all"){store.page = .inventory}.font(.body)};if w.lots.isEmpty{EmptyState(title:"Start with your first batch",message:"Add a material, create its batch, then receive stock.")}else{ForEach(Array(w.lots.prefix(3))){lot in batchRow(lot,w)}}}.panel()
    }}
    func metric(_ label:String,_ value:String,_ unit:String,_ icon:String,featured:Bool=false)->some View{VStack(alignment:.leading,spacing:16){Image(systemName:icon).font(.title3).frame(width:40,height:40).background(featured ? Color(hex:0x465334) : Color(hex:0xeaf3d9),in:RoundedRectangle(cornerRadius:10)).foregroundStyle(featured ? YF.lime : Color(hex:0x4a642b)).accessibilityHidden(true);Text(label).font(.subheadline).fixedSize(horizontal:false,vertical:true);Text(value).font(.largeTitle.bold()).tracking(-0.7).monospacedDigit().fixedSize(horizontal:false,vertical:true);Text(unit).font(.body).opacity(0.85)}.frame(maxWidth:.infinity,alignment:.leading).padding(20).background(featured ? Color(hex:0x2e3428) : YF.surface,in:RoundedRectangle(cornerRadius:16)).foregroundStyle(featured ? .white : .primary).overlay(RoundedRectangle(cornerRadius:16).stroke(featured ? Color.clear : YF.line,lineWidth:1))}
    func stockChart(_ w:Workspace)->some View{let records=Array(w.movements.sorted{$0.createdAt<$1.createdAt}.suffix(14));var running=w.total-records.reduce(0){$0+($1.fromStage==nil ? $1.grams : 0)-($1.toStage==nil ? $1.grams : 0)};let points=records.enumerated().map{index,m in running += (m.fromStage==nil ? m.grams : 0)-(m.toStage==nil ? m.grams : 0);return ChartPoint(index:index,grams:running)}
        return VStack(alignment:.leading,spacing:16){SectionTitle(title:"Stock movement",subtitle:"Recorded movements · weight in kilograms");Text("\(kg(w.total)) kg").font(.title.bold()).monospacedDigit();if points.isEmpty{EmptyState(title:"Your stock story starts here.",message:"Receive stock to see real movement history.")}else{Chart(points){p in AreaMark(x:.value("Record",p.index),y:.value("Stock kg",Double(p.grams)/1000)).foregroundStyle(LinearGradient(colors:[YF.lime.opacity(0.6),YF.lime.opacity(0.03)],startPoint:.top,endPoint:.bottom));LineMark(x:.value("Record",p.index),y:.value("Stock kg",Double(p.grams)/1000)).foregroundStyle(Color(hex:0x769831)).lineStyle(StrokeStyle(lineWidth:2.5))}.frame(height:210).chartXAxisLabel("Earlier records → latest").chartYAxisLabel("kg").accessibilityLabel("Recorded stock history ending at \(kg(w.total)) kilograms")}}.panel()
    }
    func batchList(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:store.page == .quality ? "Good stock starts with a good check." : store.page == .dispatch ? "Ready for its next destination." : store.page == .production ? "Move work forward." : "Every batch, in one place.",subtitle:store.page == .dispatch ? "Only approved batches are eligible for dispatch." : "Follow your materials from receipt to dispatch.")
        if store.page == .inventory{Button{action = w.products.isEmpty ? .material : .batch}label:{Label(w.products.isEmpty ? "Add material" : "Create batch",systemImage:"plus")}.buttonStyle(YFButton())}
        HStack{Image(systemName:"magnifyingglass").foregroundStyle(YF.muted).accessibilityHidden(true);TextField("Search material or batch",text:$query).textInputAutocapitalization(.never).accessibilityLabel("Search material or batch")}.padding(14).background(YF.surface,in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).stroke(YF.line,lineWidth:1))
        if store.page == .inventory{Picker("Quality status",selection:$filter){Text("All batches").tag("all");Text("QC approved").tag("approved");Text("Needs inspection").tag("uninspected");Text("QC hold").tag("hold")}.font(.body).pickerStyle(.menu).frame(minHeight:44)}
        VStack(spacing:0){if filtered.isEmpty{EmptyState(title:"No matching batches",message:"Try another search, or add a material and create a batch.")}else{ForEach(filtered){lot in batchRow(lot,w);if lot.id != filtered.last?.id{Divider().padding(.vertical,8)}}}}.panel()
    }}
    func batchRow(_ lot:Batch,_ w:Workspace)->some View{Button{selected=lot}label:{VStack(alignment:.leading,spacing:12){HStack(alignment:.top,spacing:12){VStack(alignment:.leading,spacing:7){Text(w.name(lot)).font(.headline).foregroundStyle(.primary).multilineTextAlignment(.leading);Text(lot.batch).font(.subheadline).foregroundStyle(YF.muted)};Spacer(minLength:8);Text("\(kg(w.grams(lot.id))) kg").font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.primary).multilineTextAlignment(.trailing)};StatusBadge(status:lot.quality)}.padding(.vertical,12).frame(maxWidth:.infinity,alignment:.leading)}.buttonStyle(.plain).accessibilityHint("Opens batch details and stock actions")}
    func materials(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"Material catalogue",subtitle:"Specifications, SKUs, and batch traceability.");if store.isOwner{Button{action = .material}label:{Label("Add material",systemImage:"plus")}.buttonStyle(YFButton())};ForEach(w.products){p in VStack(alignment:.leading,spacing:12){Label(p.name,systemImage:"cube").font(.headline);Text(p.sku).font(.body).foregroundStyle(YF.muted);Text("\(w.lots.filter{$0.productId==p.id}.count) batches").font(.subheadline).foregroundStyle(YF.muted)}.panel()};if w.products.isEmpty{EmptyState(title:"Your materials belong here.",message:"Add a material to start receiving stock.")}}}
    func activity(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"Every move has a story.",subtitle:"Original records remain traceable.");if w.movements.isEmpty{EmptyState(title:"No movements yet",message:"Receive stock into a batch to start the audit history.")};ForEach(w.movements){m in VStack(alignment:.leading,spacing:12){Label(m.action.capitalized,systemImage:m.action=="receive" ? "arrow.down.left" : m.action=="dispatch" ? "truck.box" : "arrow.left.arrow.right").font(.headline);Text("\(w.batchName(m.lotId)) · \(kg(m.grams)) kg").font(.body).monospacedDigit();Text("\(m.fromStage.map(stageName) ?? "External") → \(m.toStage.map(stageName) ?? "External")").font(.body).foregroundStyle(YF.muted);if !m.note.isEmpty{Text(m.note).font(.body)};Text("\(m.actorName) · \(recordDate(m.createdAt))").font(.subheadline).foregroundStyle(YF.muted)}.panel()}}}
    func reports(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:24){SectionTitle(title:"A little perspective.",subtitle:"Summaries from recorded stock, never estimates.");stockChart(w);VStack(alignment:.leading,spacing:18){Text("Workspace summary").font(.title3.bold());FactRow("Stock on hand","\(kg(w.total)) kg");FactRow("Materials","\(w.products.count)");FactRow("Batches","\(w.lots.count)");FactRow("QC holds","\(w.lots.filter{$0.quality=="hold"}.count)");Text("Complete JSON backups are available in the web app’s Reports page.").font(.body).foregroundStyle(YF.muted)}.panel()}}
    func team(_ w:Workspace)->some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"People & access",subtitle:"The right decisions, in the right hands.");ForEach(Array(w.members.enumerated()),id:\.offset){_,m in VStack(alignment:.leading,spacing:10){Label(m.name,systemImage:"person.crop.circle").font(.headline);Text(m.role=="owner" ? "Owner · QC approval and invites" : "Operator · stock and inspections").font(.body).foregroundStyle(YF.muted)}.panel()};Text("Create single-use team invites from People & access in the web app. Site access is separate from workspace membership.").font(.body).foregroundStyle(YF.muted)}}
    var help:some View{VStack(alignment:.leading,spacing:20){SectionTitle(title:"A little guidance, a smoother day.");ForEach([("Receive stock","Add a material, create its batch, then choose Receive stock. Review every quantity before saving."),("Quality approval","Inspect the physical material and record the reason. Only an owner can release a QC hold."),("Correct an entry","Use the web activity register to reverse a movement with a reason. Original records stay visible."),("Camera & privacy","Photos stay on your device until you explicitly send an inspection to the model. An uncertain result stays uncertain."),("Your data","Review mode stays in memory and is cleared on sign-out. Connected mode uses your server ledger. A connection failure never substitutes sample stock.")],id:\.0){title,text in DisclosureGroup(title){Text(text).font(.body).foregroundStyle(YF.muted).padding(.top,12)}.font(.headline).panel()}}}
}
struct ChartPoint:Identifiable{let index:Int;let grams:Int;var id:Int{index}}

struct FactRow:View { let title:String;let value:String;init(_ title:String,_ value:String){self.title=title;self.value=value};var body:some View{LabeledContent(title,value:value).font(.body)} }
