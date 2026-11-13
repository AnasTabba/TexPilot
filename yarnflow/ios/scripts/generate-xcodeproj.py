#!/usr/bin/env python3
"""Generate the dependency-free native app and test project; no signing configuration."""
from pathlib import Path
import hashlib
root=Path(__file__).resolve().parents[1]
objects={}
def uid(s): return hashlib.sha256(s.encode()).hexdigest()[:24].upper()
def add(k,v): objects[uid(k)]=v; return uid(k)
def arr(xs): return '('+','.join(xs)+',);'
def ref(path,kind): return add(path, f'{{isa=PBXFileReference; lastKnownFileType={kind}; path="{path}"; sourceTree="<group>";}}')
products=[]; targets=[]; groups=[]
project=uid('project'); main=uid('main'); productGroup=uid('products')
for name,folder,ptype,ext in [('Yarnflow','Yarnflow','application','app'),('YarnflowTests','YarnflowTests','bundle.unit-test','xctest'),('YarnflowUITests','YarnflowUITests','bundle.ui-testing','xctest')]:
    files=[ref(str(p.relative_to(root)),'sourcecode.swift') for p in sorted((root/folder).glob('*.swift'))]
    src=add(name+'sources','{isa=PBXSourcesBuildPhase; buildActionMask=2147483647; files='+arr([add(f+'build','{isa=PBXBuildFile; fileRef='+f+';}') for f in files])+' runOnlyForDeploymentPostprocessing=0;}')
    phases=[src]
    if name=='Yarnflow':
        resources=[ref('Yarnflow/Localizable.xcstrings','text.json.xcstrings'),ref('../../scanner/contracts/qc-v2.schema.json','text.json')]
        resources += [ref(str(p.relative_to(root)),'image.png') for p in sorted((root/'Resources').glob('*.png'))]
        resources += [ref('../artwork/scanner-outcomes/manifest.json','text.json')]
        phases.append(add('resources','{isa=PBXResourcesBuildPhase; buildActionMask=2147483647; files='+arr([add(f+'resource','{isa=PBXBuildFile; fileRef='+f+';}') for f in resources])+' runOnlyForDeploymentPostprocessing=0;}'))
        files += resources
    groups+=files
    product=add(name+'product',f'{{isa=PBXFileReference; explicitFileType={"wrapper.application" if ext=="app" else "wrapper.cfbundle"}; path={name}.{ext}; sourceTree=BUILT_PRODUCTS_DIR;}}'); products.append(product)
    configs=[]
    for mode in ['Debug','Release']:
        settings={'PRODUCT_NAME':'"$(TARGET_NAME)"','PRODUCT_BUNDLE_IDENTIFIER':f'com.texpilot.{name.lower()}','SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'17.0','TARGETED_DEVICE_FAMILY':'"1,2"','SDKROOT':'iphoneos','SUPPORTED_PLATFORMS':'"iphoneos iphonesimulator"','CODE_SIGNING_ALLOWED':'NO','SWIFT_OPTIMIZATION_LEVEL':'"-Onone"' if mode=='Debug' else '"-O"','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if mode=='Debug' else '""','CLANG_ENABLE_MODULES':'YES','OTHER_SWIFT_FLAGS':'"$(inherited) -disable-sandbox"'}
        if name=='Yarnflow': settings.update({'INFOPLIST_FILE':'Info.plist','GENERATE_INFOPLIST_FILE':'NO','ENABLE_TESTABILITY':'YES','LD_RUNPATH_SEARCH_PATHS':'"$(inherited) @executable_path/Frameworks"'})
        else:
            settings.update({'GENERATE_INFOPLIST_FILE':'YES','LD_RUNPATH_SEARCH_PATHS':'"$(inherited) @executable_path/Frameworks @loader_path/Frameworks"'})
            if name=='YarnflowTests': settings.update({'TEST_HOST':'"$(BUILT_PRODUCTS_DIR)/Yarnflow.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Yarnflow"','BUNDLE_LOADER':'"$(TEST_HOST)"'})
            else: settings['TEST_TARGET_NAME']='Yarnflow'
        configs.append(add(name+mode,'{isa=XCBuildConfiguration; name='+mode+'; buildSettings={'+''.join(k+'='+v+';' for k,v in settings.items())+'};}'))
    cl=add(name+'config','{isa=XCConfigurationList; buildConfigurations='+arr(configs)+' defaultConfigurationIsVisible=0; defaultConfigurationName=Release;}')
    deps=[]
    if name!='Yarnflow':
        proxy=add(name+'proxy','{isa=PBXContainerItemProxy; containerPortal='+project+'; proxyType=1; remoteGlobalIDString='+uid('Yarnflowtarget')+'; remoteInfo=Yarnflow;}')
        deps=[add(name+'dependency','{isa=PBXTargetDependency; target='+uid('Yarnflowtarget')+'; targetProxy='+proxy+';}')]
    targets.append(add(name+'target',f'{{isa=PBXNativeTarget; buildConfigurationList={cl}; buildPhases={arr(phases)} buildRules=(); dependencies={arr(deps) if deps else "();"} name={name}; productName={name}; productReference={product}; productType="com.apple.product-type.{ptype}";}}'))
configs=[add('project'+m,'{isa=XCBuildConfiguration; name='+m+'; buildSettings={};}') for m in ['Debug','Release']]
cl=add('projectconfig','{isa=XCConfigurationList; buildConfigurations='+arr(configs)+' defaultConfigurationIsVisible=0; defaultConfigurationName=Release;}')
add('products','{isa=PBXGroup; children='+arr(products)+' name=Products; sourceTree="<group>";}')
add('main','{isa=PBXGroup; children='+arr(groups+[productGroup])+' sourceTree="<group>";}')
add('project','{isa=PBXProject; attributes={BuildIndependentTargetsInParallel=YES; LastUpgradeCheck=2660;}; buildConfigurationList='+cl+'; compatibilityVersion="Xcode 14.0"; developmentRegion=en; knownRegions=(en,ur,Base); mainGroup='+main+'; productRefGroup='+productGroup+'; projectDirPath=""; projectRoot=""; targets='+arr(targets)+';}')
p=root/'Yarnflow.xcodeproj'; p.mkdir(exist_ok=True)
(p/'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion=1; classes={}; objectVersion=56; objects={\n'+ '\n'.join(k+'='+v+';' for k,v in objects.items())+'\n}; rootObject='+project+';}\n')
text=(p/'project.pbxproj').read_text().replace(';;',';')
(p/'project.pbxproj').write_text(text)
s=p/'xcshareddata/xcschemes'; s.mkdir(parents=True,exist_ok=True)
def buildable(name): return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid(name+"target")}" BuildableName="{name}.{ "app" if name=="Yarnflow" else "xctest"}" BlueprintName="{name}" ReferencedContainer="container:Yarnflow.xcodeproj"/>'
(s/'Yarnflow.xcscheme').write_text('<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2660" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>'+''.join('<BuildActionEntry buildForTesting="YES" buildForRunning="'+('YES' if n=='Yarnflow' else 'NO')+'" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">'+buildable(n)+'</BuildActionEntry>' for n in ['Yarnflow','YarnflowTests','YarnflowUITests'])+'</BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>'+''.join('<TestableReference skipped="NO">'+buildable(n)+'</TestableReference>' for n in ['YarnflowTests','YarnflowUITests'])+'</Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">'+buildable('Yarnflow')+'</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"/><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>')
