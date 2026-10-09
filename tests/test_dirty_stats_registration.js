"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {runtimePath,sourcePath}=require("./plugin_paths");
const {requireBuild,pluginFor}=require("../scripts/build-lib.cjs");
const {element}=require("./ui_harness");
const code=fs.readFileSync(runtimePath("DirtyStats","dirtyStats.js"),"utf8");
const manifest=fs.readFileSync(runtimePath("DirtyStats","dirtyStats.yml"),"utf8");
assert.match(manifest,/javascript:\s*\n\s*- dirtyStats\.js\s*\n\s*css:/);
assert(!code.includes("sourceMappingURL"),"release bundles carry no source map");
// esbuild's recorded dependency graph replaces the development map's source list.
const inputs=requireBuild().plugins.DirtyStats.metafile.inputs;
assert(inputs["plugins/DirtyStats/src/index.tsx"]&&inputs["plugins/DirtyStats/src/dashboard/Page.tsx"]);
// Stats owns its inputs plus the pinned packages it declares; no hub or React copies.
const bundled=pluginFor("DirtyStats").bundledPackages;
assert.deepEqual(bundled,["echarts","zrender","tslib"]);
assert(Object.keys(inputs).every(file=>file.startsWith("plugins/DirtyStats/")||bundled.some(name=>file.startsWith("node_modules/"+name+"/"))),"only Stats-owned and declared package inputs");
assert(inputs["plugins/DirtyStats/src/echarts.ts"]&&inputs["node_modules/echarts/lib/chart/map/install.js"],"modular ECharts imports");
assert(!Object.keys(inputs).some(file=>/vendor\/echarts|node_modules\/(react|react-dom)\//.test(file)),"no full ECharts distribution or React copy");
assert(code.includes("DirtyStats bundles parts of Apache ECharts 5.6.0"),"bundle keeps its third-party attribution");
// Every series type the views configure must be registered by the modular import.
const registered=fs.readFileSync(sourcePath("DirtyStats","src/echarts.ts"),"utf8");
const sourceFiles=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sourceFiles(dir+"/"+entry.name):[dir+"/"+entry.name]);
const seriesTypes=new Set(sourceFiles(sourcePath("DirtyStats","src")).filter(file=>/\.tsx?$/.test(file)&&!file.endsWith("echarts.ts"))
  .flatMap(file=>[...fs.readFileSync(file,"utf8").matchAll(/type: *"(line|bar|pie|scatter|effectScatter|radar|map|tree|treemap|graph|gauge|funnel|parallel|sankey|boxplot|candlestick|lines|heatmap|pictorialBar|themeRiver|sunburst|custom)"/g)].map(match=>match[1])));
assert(seriesTypes.size>=7,"series inventory found");
for(const type of seriesTypes)assert(new RegExp("\\b"+type[0].toUpperCase()+type.slice(1)+"Chart\\b").test(registered),"modular ECharts must register the "+type+" series");
function fixture(fail={}) {
  const routes=[],patches=[],listeners=new Map(),themes=new Set(),errors=[];
  const noop=()=>{};
  const React={createElement:element,Fragment:"fragment",useState:value=>[value,noop],useEffect:noop,useMemo:fn=>fn(),useRef:value=>({current:value})};
  const host={React,ReactDOM:{createPortal:element},GQL:{},components:{},libraries:{ReactRouterDOM:{}},
    register:{route:(path,component)=>{routes.push({path,component});if(fail.route)throw Error("route registration");}},
    patch:{instead:(name,handler)=>{patches.push({name,handler});if(fail.patch===name)throw Error("patch registration");},before:(name,handler)=>patches.push({name,handler})}};
  const hub={graphql:async()=>({}),getPluginSettings:async()=>({}),configurePlugin:async()=>({}),createSaveController:()=>({dispose:noop}),
    native:{ensureComponents:async()=>[]},react:{StateView:noop,StatisticSelector:noop},theme:{defaultKey:"classic",subscribe:listener=>{themes.add(listener);return()=>themes.delete(listener);}}};
  const window={PluginApi:host,DirtyPlugins:hub,location:{pathname:"/other",search:""},
    addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>{listeners.delete(name);if(fail.cleanup)throw Error("cleanup");},setTimeout,clearTimeout};
  const context=vm.createContext({window,navigator:{userAgent:"Synthetic Stash host"},document:{documentElement:{style:{}}},console:{warn:noop,error:(...args)=>errors.push(args)},URLSearchParams,Intl,Event,setTimeout,clearTimeout});
  return {context,window,host,hub,routes,patches,listeners,themes,errors,load:()=>vm.runInContext(code,context)};
}
for(const missing of ["host","React","route","patch","graphql","react","native"]) {
  const f=fixture();
  if(missing==="host")delete f.window.PluginApi;
  else if(missing==="React")delete f.host.React;
  else if(missing==="route")delete f.host.register.route;
  else if(missing==="patch")delete f.host.patch.instead;
  else delete f.hub[missing];
  f.load();assert.equal(f.window.__dirtyStatsPlugin,undefined,missing+" dependency prevents guard/registration");assert.equal(f.routes.length,0);
}
const f=fixture();f.load();
assert.equal(f.window.__dirtyStatsPlugin.status,"active");assert.equal(f.routes.length,1);
assert.equal(f.routes[0].path,"/plugins/dirty-stats");
assert.deepEqual(f.patches.map(p=>p.name),["PerformerList","SceneList","MainNavBar.UtilityItems"]);
assert.equal(f.listeners.size,1);assert.equal(f.themes.size,1);
assert.equal(f.window.echarts,undefined,"ECharts stays private to the bundle");assert.equal(f.window.__dirtyStatsWorld,undefined);
assert.equal(f.window.__dirtyStatsPlugin.algorithms,undefined,"domain APIs belong to imported modules");
f.load();assert.equal(f.routes.length,1);assert.equal(f.patches.length,3);assert.equal(f.listeners.size,1);
const original={native:true},filter={};
for(const path of ["/performers","/scenes","/plugins/other","/plugins/dirty-stats"]) {
  f.window.location.pathname=path;
  assert.equal(f.patches[0].handler({filter,extraCriteria:{}},()=>original),original);
  assert.equal(f.patches[1].handler({filter},()=>original),original);
}
f.window.location.pathname="/plugins/dirty-stats/quality-efficiency";
assert.equal(f.patches[1].handler({filter},()=>original).type.name,"QualityEfficiencyPage");
f.window.location.pathname="/plugins/dirty-stats/performer-ratings";
assert.equal(f.patches[0].handler({filter,extraCriteria:{dirtyStats:true}},()=>original).props.performerMode,true);
f.window.__dirtyStatsPlugin.destroy();f.window.__dirtyStatsPlugin.destroy();
assert.equal(f.window.__dirtyStatsPlugin.status,"destroyed");assert.equal(f.listeners.size,0);assert.equal(f.themes.size,0);
for(const patch of f.patches.slice(0,2))assert.equal(patch.handler({filter,extraCriteria:{dirtyStats:true}},()=>original),original);
assert.equal(f.patches[2].handler(original)[0],original);
f.load();assert.equal(f.routes.length,1);
for(const failure of [{route:true},{patch:"PerformerList"},{patch:"SceneList"}]) {
  const partial=fixture(failure);partial.load();assert.equal(partial.window.__dirtyStatsPlugin.status,"failed");
  const count=partial.routes.length;partial.load();assert.equal(partial.routes.length,count);
  assert.equal(partial.listeners.size,0);assert.equal(partial.themes.size,0);
}
const cleanup=fixture({cleanup:true});cleanup.load();cleanup.window.__dirtyStatsPlugin.destroy();assert.equal(cleanup.themes.size,0,"one cleanup error must release other effects");
const retry=fixture();retry.context.Intl={DisplayNames:function(){throw Error("factory initialization")}};retry.load();assert.equal(retry.window.__dirtyStatsPlugin,undefined);assert.equal(retry.routes.length,0);retry.context.Intl=Intl;retry.load();assert.equal(retry.window.__dirtyStatsPlugin.status,"active");retry.window.__dirtyStatsPlugin.destroy();
console.log("DirtyStats compiled registration, modular ECharts registrations, map-free release bundle, duplicate/partial guards and owned cleanup passed");
