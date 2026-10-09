"use strict";
const fs=require("node:fs"),vm=require("node:vm");
const {testModulePath}=require("./plugin_paths");
function moduleIn(context,name) {
  if(!vm.isContext(context))vm.createContext(context);
  const module={exports:{}};context.module=module;context.exports=module.exports;
  vm.runInContext(fs.readFileSync(testModulePath("DirtyStats",name+".cjs"),"utf8"),context);
  return module.exports;
}
function runtime(context) {
  const api=context.window.PluginApi,hub=context.window.DirtyPlugins;
  hub.react ||= {};
  // The 1.0 hub always provides the full theme API; suites override what they exercise.
  hub.theme = Object.assign({defaultKey:"classic",currentKey:"classic",normalizeKey:key=>key,ready:Promise.resolve("classic"),readRole:()=>"",subscribe:()=>()=>{}},hub.theme);
  api.libraries ||= {};api.libraries.ReactRouterDOM ||= {};
  return {React:api.React,api,hub,charts:context.window.echarts,world:moduleIn(context,"world").world,filterBridge:{activeEntity:null,listener:null}};
}
function core(context) {
  const app=moduleIn(context,"views").createViews(runtime(context));
  const ready=app.start();
  return Object.assign(app,{settingsReady:ready,getSaveStatus:app.settings.getSaveStatus,getSettingExtra:app.settings.getStatsSettingExtra,setSettingExtra:app.settings.setStatsSettingExtra});
}
function dashboard(context,algorithms={},core={}) {
  return moduleIn(context,"views").createDashboardViews(runtime(context),algorithms,core);
}
module.exports={moduleIn,core,dashboard};
