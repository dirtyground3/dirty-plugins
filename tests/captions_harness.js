"use strict";
const vm = require("node:vm"), {sourceFor} = require("./load_plugin_scripts");
const {createHooks, findAll, text, events} = require("./ui_harness");
const {installJobHelpers} = require("./shared_runtime");
const {testModulePath} = require("./plugin_paths");
const values = require(testModulePath("DirtyPlugins", "values.cjs"));
const copy = value => JSON.parse(JSON.stringify(value));
function createCaptionsHarness(options = {}) {
  let owner, changed = true, tree, addon, event, scene = options.scene || {id:"1",files:[{id:"10",size:100}]};
  let mounted = true, activePlayer = options.player;
  const owners = new Map(), patches = new Map(), patchNames = [], calls = [], errors = [], statuses = [], timers = new Map(), observers = [];
  let nextTimer = 0;
  const hooks = createHooks(() => owner);
  const React = {...hooks, Fragment: Symbol("host Fragment"),
    createElement: (type, props, ...children) => ({type,props:{...props,children:children.length===1 ? children[0] : children},children}),
    isValidElement: node => !!node?.type,
    cloneElement: (node, props, ...children) => {
      const next = children.length ? (children.length===1 ? children[0] : children) : node.props.children;
      return {...node,props:{...node.props,...props,children:next},children:Array.isArray(next) ? next : [next]};
    },
    useState(initial) {const [value,set]=hooks.useState(initial);return [value,next=>{statuses.push(next);set(next);changed=true;}];},
  };
  const controls = Object.fromEntries(["SettingsSection","Button"].map(name => [name,props=>React.createElement(name,props,props.children)]));
  const hub = {react:controls,values,captureEnabled:()=>!!options.capture,
    getPluginSettings:async()=>options.load ? options.load() : (options.settings || {}),
    runPluginOperation:async(id,args)=>{calls.push(copy(args));return options.operation ? options.operation(args) :
      args.mode === "captions" ? {sceneId:String(scene.id),fileId:"10",tracks:[],warnings:[]} : {status:args.mode === "indexRefresh" ? "Running" : "Finished",checked:2,skipped:2};},
    registerSettingsAddon(id,component){addon=component;options.register?.();},
    unregisterSettingsAddon(id,component){if(addon===component){addon=null;changed=true;}},
  };
  const window=events({DirtyPlugins:hub,navigator:{language:"en-US"},location:{search:options.capture ? "?docsCapture=1" : ""},
    setTimeout:fn=>{const id=++nextTimer;timers.set(id,{fn,kind:"timeout"});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,kind:"interval",delay});return id;},clearInterval:id=>timers.delete(id),
    PluginApi:{React,libraries:{Intl:{useIntl:()=>options.intl || {messages:{}}}},GQL:{useJobsSubscribeSubscription:()=>({data:{jobsSubscribe:event}})},
      patch:{after(name,callback){patchNames.push(name);patches.set(name,callback);options.patch?.(name);}}}});
  installJobHelpers(window);
  class Observer {constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(){this.connected=true;}disconnect(){this.connected=false;}}
  const context=vm.createContext({window,Intl,MutationObserver:Observer,console:{error:(...args)=>errors.push(args)}});
  const load=()=>vm.runInContext(sourceFor("DirtyCaptions"),context);
  function release(item){for(const slot of item.slots)slot?.cleanup?.();}
  function render(){
    changed=false;const seen=new Set();
    function visit(node,address){
      if(Array.isArray(node))return node.map((child,index)=>visit(child,address+"/"+(child?.props?.key ?? index)));
      if(!node || typeof node!=="object" || !node.type)return node;
      if(typeof node.type==="function"){
        const key=address+":"+node.type.name;seen.add(key);
        if(!owners.has(key))owners.set(key,{slots:[],cursor:0,effects:[]});
        owner=owners.get(key);owner.cursor=0;return visit(node.type(node.props),key);
      }
      if(node.props?.ref && node.props.className?.includes("dirty-captions-status"))node.props.ref.current={parentElement:{querySelector:()=>activePlayer ? {player:activePlayer} : null}};
      return {...node,children:visit(node.children,address+"/children")};
    }
    const native=React.createElement("native-player",{className:"VideoPlayer"},React.createElement("video-wrapper",{}));
    tree=mounted ? visit([addon && React.createElement(addon,{}),patches.get("App")?.(React.createElement("native-app",{})),
      patches.get("ScenePlayer")?.({scene},{},native)],"root") : null;
    for(const [key,item]of owners)if(!seen.has(key)){release(item);owners.delete(key);}
    for(const item of owners.values())for(const effect of item.effects.splice(0))effect();
    return tree;
  }
  async function flush(){for(let i=0;i<30;i++){if(changed)render();await Promise.resolve();}return tree;}
  return {window,context,hub,React,load,flush,patches,patchNames,calls,errors,statuses,timers,observers,
    get tree(){return tree;},get addon(){return addon;},nodes:predicate=>findAll(tree,predicate),
    button(label){return findAll(tree,node=>node.type==="Button" && text(node)===label)[0];},
    async click(label){const node=this.button(label);if(!node)throw Error("Missing "+label);node.props.onClick();await flush();},
    async event(value){event=value;changed=true;await flush();},
    async tick(delay){for(const value of [...timers.values()])if(value.kind==="interval" && value.delay===delay)value.fn();await flush();},
    async scene(value){scene=value;changed=true;await flush();},
    async player(value){activePlayer=value;for(const observer of observers)if(observer.connected)observer.callback();await flush();},
    async unmount(){mounted=false;changed=true;await flush();},
  };
}
module.exports={createCaptionsHarness};
