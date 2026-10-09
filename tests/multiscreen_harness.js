"use strict";
const vm=require("node:vm"),{sourceFor}=require("./load_plugin_scripts"),{testModulePath}=require("./plugin_paths");
const {createHooks,findAll,text,events}=require("./ui_harness"),{installMetadata}=require("./shared_runtime");
const values=require(testModulePath("DirtyPlugins","values.cjs"));
function createMultiscreenHarness(options={}) {
  let owner,changed=true,tree,mounted=true,mode=options.mode || "route",path=options.path || "/scenes",nextTimer=0;
  const owners=new Map(),routes=[],patches=new Map(),patchNames=[],calls=[],errors=[],timers=new Map(),observers=[],media=new Map(),nativeCalls=[];
  const hooks=createHooks(()=>owner);
  const React={...hooks,Fragment:"fragment",createElement:(type,props,...children)=>({type,props:{...props,children},children}),
    useMemo(factory,deps){const index=owner.cursor++,old=owner.slots[index];if(!old || deps.some((d,i)=>d!==old.deps[i]))owner.slots[index]={deps,value:factory()};return owner.slots[index].value;},
    useState(initial){const item=owner,index=item.cursor;const [value,set]=hooks.useState(initial);item.setters ||= new Map();if(!item.setters.has(index))item.setters.set(index,next=>{set(next);changed=true;});return [value,item.setters.get(index)];}};
  class Video {constructor(){events(this);this.currentTime=0;this.paused=false;this.ended=false;this.isConnected=true;this.playCount=0;this.pauseCount=0;}pause(){this.paused=true;this.pauseCount++;}play(){this.paused=false;this.playCount++;return Promise.resolve();}}
  function newMedia() {
    const video=new Video(),persist={enabled:true,ready(){}},player=events({disposed:false,v:1,m:false,isDisposed(){return this.disposed;},persistVolume:()=>persist,
      ready(fn){this.readyCallback=fn;fn();},volume(v){if(v===undefined)return this.v;this.v=v;this.emit("volumechange");},muted(v){if(v===undefined)return this.m;this.m=v;this.emit("volumechange");}});
    const tile={querySelector:selector=>selector==="video" ? video : selector==="video-js" ? {player} : null};return {video,player,persist,tile};
  }
  const scenes=options.scenes || [{id:"a",title:"Alpha",paths:{stream:"/a"},files:[{duration:10}]},{id:"b",title:"Beta",paths:{stream:"/b"},files:[{duration:20}]}];
  function NativePlayer(props) {
    nativeCalls.push(props);const current=media.get(owner.address); // native shares its tile by prefix below
    const pair=current || [...media].find(([key])=>owner.address.startsWith(key+"/"))?.[1];
    props.sendSetTimestamp(seconds=>{if(pair)pair.video.currentTime=seconds;});
    React.useEffect(()=>()=>{if(pair){pair.player.disposed=true;pair.video.isConnected=false;}},[]);
    return React.createElement("native-player",props);
  }
  const controls=Object.fromEntries(["IconButton","StateView","NavAction"].map(name=>[name,props=>React.createElement(name,props,props.children)]));
  const hub={values,react:{...controls,usePageTitle(){}},captureEnabled:()=>!!options.capture,debugLog(){},native:{loadComponent:async()=>NativePlayer},
    getPluginSettings:async()=>options.loadSettings ? options.loadSettings() : options.settings || {rows:1,columns:2,totalScreens:2,randomize:false,randomStart:false,loopScenes:false},
    graphql:async(query,variables)=>{calls.push({query,variables});if(options.graphql)return options.graphql(query,variables);
      if(query.includes("MultiscreenMarkers"))return {findSceneMarkers:{count:options.markers?.length || 0,scene_markers:options.markers || []}};
      if(query.includes("MultiscreenScenes"))return {findScenes:{count:scenes.length,scenes}};
      if(query.includes("MultiscreenSceneCount"))return {findScenes:{count:scenes.length}};
      if(query.includes("MultiscreenMarkerCount"))return {findSceneMarkers:{count:options.markers?.length || 0}};
      if(query.includes("MultiscreenPerformers"))return {findPerformers:{performers:[{id:"p1"}]}};
      if(query.includes("MultiscreenStudios"))return {findStudios:{studios:[{id:"s1"}]}};return {};}};
  const storage=new Map(options.launch ? [["multiscreen.launchContext",JSON.stringify(options.launch)]] : []);
  const document=events({hidden:false}),grid=events({querySelectorAll:()=>[...media.values()].map(pair=>pair.video).filter(video=>video.isConnected),contains:video=>[...media.values()].some(pair=>pair.video===video && video.isConnected)});
  const window={DirtyPlugins:hub,location:{get pathname(){return path;},search:options.capture ? "?docsCapture=1" : "",assign:value=>{path=value;}},history:{length:1,back(){}},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),sessionStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    PluginApi:{React,components:{ScenePlayer:NativePlayer},utils:{StashService:{useFindScene:id=>({loading:false,data:{findScene:scenes.find(scene=>scene.id===id)}})}},libraries:{ReactRouterDOM:{NavLink:props=>React.createElement("NavLink",props,props.children),useLocation:()=>({pathname:path})},FontAwesomeSolid:{}},
      register:{route(...args){routes.push(args);options.register?.();}},patch:{before(name,fn){patchNames.push(name);patches.set(name,fn);options.patch?.(name);}}}};
  installMetadata(window);
  class Observer {constructor(callback){this.callback=callback;this.connected=false;observers.push(this);}observe(target){this.target=target;this.connected=true;}disconnect(){this.connected=false;}}
  const context=vm.createContext({window,document,HTMLVideoElement:Video,MutationObserver:Observer,console:{error:(...args)=>errors.push(args)},URLSearchParams,Set});
  const load=()=>vm.runInContext(sourceFor("DirtyMultiscreen"),context);
  function release(item){for(const slot of item.slots)slot?.cleanup?.();}
  function render() {
    changed=false;const seen=new Set();
    function visit(node,address) {
      if(Array.isArray(node))return node.map((child,i)=>visit(child,address+"/"+(child?.props?.key ?? i)));
      if(!node || typeof node!=="object" || !node.type)return node;
      if(node.props.key!=null)address+="["+node.props.key+"]";
      if(typeof node.type==="function") {
        const key=address+":"+node.type.name;seen.add(key);
        if(!owners.has(key))owners.set(key,{slots:[],cursor:0,effects:[],address:key});
        owner=owners.get(key);owner.cursor=0;return visit(node.type(node.props),key);
      }
      if(node.props.ref && node.props.className?.includes("ms-native-tile")) {
        if(!media.has(address) || !media.get(address).video.isConnected)media.set(address,newMedia());node.props.ref.current=media.get(address).tile;
      }
      if(node.props.ref && node.props.className?.includes("ms-native-grid"))node.props.ref.current=grid;
      return {...node,children:visit(node.children,address+"/children")};
    }
    const native=React.createElement("original-nav",{});
    tree=mounted ? visit(mode==="route" && routes[0] ? React.createElement(routes[0][1],{}) : patches.get("MainNavBar.UtilityItems")?.({children:native})[0].children,"root") : null;
    for(const [key,item]of owners)if(!seen.has(key)){release(item);owners.delete(key);}
    for(const item of owners.values())for(const effect of item.effects.splice(0))effect();return tree;
  }
  async function flush(){for(let i=0;i<40;i++){if(changed)render();await Promise.resolve();}return tree;}
  return {window,document,grid,context,React,hub,routes,patches,patchNames,calls,errors,timers,observers,media,nativeCalls,storage,load,flush,get tree(){return tree;},
    nodes:predicate=>findAll(tree,predicate),button:label=>findAll(tree,node=>node.type==="IconButton" && node.props.ariaLabel===label)[0],
    async tick(delay){for(const [id,timer]of [...timers])if(delay===undefined || timer.delay===delay){timers.delete(id);timer.fn();}await flush();},
    async path(value){path=value;changed=true;await flush();},async mode(value){mode=value;changed=true;await flush();},
    async rerender(){changed=true;await flush();},async unmount(){mounted=false;changed=true;await flush();},
    async destroy(){window.__dirtyMultiscreenPlugin.destroy();changed=true;await flush();},text:()=>text(tree),
    replacePlayer(pair){const next=newMedia();pair.player=next.player;pair.persist=next.persist;pair.tile.querySelector=next.tile.querySelector;pair.video=next.video;for(const observer of observers)if(observer.connected)observer.callback();return pair;}};
}
module.exports={createMultiscreenHarness};
