"use strict";
const DEBUG_PROTOCOL = "1.3";
const TAB_STORAGE_KEY = "emulatedTabs";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeUrl(raw) {
  const url = new URL(String(raw || ""));
  if (!["http:","https:"].includes(url.protocol)) {
    throw new Error("فقط صفحات HTTP و HTTPS قابل شبیه‌سازی هستند.");
  }
  return url.href;
}
function sanitizeDevice(input) {
  const width = Math.round(Number(input && input.width));
  const height = Math.round(Number(input && input.height));
  const dpr = Number(input && input.dpr) || 2;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 240 || width > 2000 || height < 320 || height > 2200) {
    throw new Error("ابعاد دستگاه باید بین ۲۴۰ تا ۲۰۰۰ پیکسل عرض و ۳۲۰ تا ۲۲۰۰ پیکسل ارتفاع باشد.");
  }
  const device = {
    id:String((input && input.id) || "custom").slice(0,60),
    name:String((input && input.name) || "Custom").slice(0,70),
    width,height,dpr:Math.max(1,Math.min(4,dpr)),
    mobile: input && input.mobile !== false,
    landscape:Boolean(input && input.landscape)
  };
  return device;
}
async function readTabs() {
  const result = await chrome.storage.session.get(TAB_STORAGE_KEY);
  return result[TAB_STORAGE_KEY] || {};
}
async function saveDevice(tabId,device) {
  const tabs = await readTabs();
  tabs[String(tabId)] = device;
  await chrome.storage.session.set({[TAB_STORAGE_KEY]:tabs});
}
async function forgetDevice(tabId) {
  const tabs = await readTabs();
  delete tabs[String(tabId)];
  await chrome.storage.session.set({[TAB_STORAGE_KEY]:tabs});
}
async function attachIfNeeded(tabId) {
  const target = {tabId};
  try {
    await chrome.debugger.attach(target,DEBUG_PROTOCOL);
  } catch (error) {
    // The extension might already own this session after service worker suspension.
    try {
      await chrome.debugger.sendCommand(target,"Runtime.evaluate",{expression:"true",returnByValue:true});
    } catch (_) {
      throw new Error("اتصال به ابزار شبیه‌سازی ممکن نیست. DevTools را ببندید و دوباره تلاش کنید. " + (error.message || ""));
    }
  }
}
async function applyDevice(tabId,rawDevice) {
  const device = sanitizeDevice(rawDevice);
  const target = {tabId};
  const width = device.landscape ? device.height : device.width;
  const height = device.landscape ? device.width : device.height;
  await attachIfNeeded(tabId);
  await chrome.debugger.sendCommand(target,"Emulation.setDeviceMetricsOverride",{
    width,height,deviceScaleFactor:device.dpr,mobile:device.mobile,
    screenWidth:width,screenHeight:height,
    screenOrientation:{type:device.landscape?"landscapePrimary":"portraitPrimary",angle:device.landscape?90:0}
  });
  await chrome.debugger.sendCommand(target,"Emulation.setTouchEmulationEnabled",{
    enabled:device.mobile,maxTouchPoints:1
  });
  await saveDevice(tabId,device);
  return {ok:true,tabId,device};
}
async function openDevice(url,device) {
  const href = sanitizeUrl(url);
  const tab = await chrome.tabs.create({url:href,active:true});
  try {
    // Allow navigation to establish a debuggable page target.
    let error;
    for(let i=0;i<3;i++){
      try {return await applyDevice(tab.id,device);}
      catch(err){error=err;await pause(350);}
    }
    throw error;
  } catch(error) {
    throw new Error("تب باز شد اما شبیه‌سازی فعال نشد: "+error.message);
  }
}
async function clearDevice(tabId) {
  const target = {tabId};
  try {
    await chrome.debugger.sendCommand(target,"Emulation.clearDeviceMetricsOverride");
    await chrome.debugger.sendCommand(target,"Emulation.setTouchEmulationEnabled",{enabled:false});
  } catch (_) { /* The debugger might have been detached already. */ }
  try {await chrome.debugger.detach(target);} catch (_) { /* Already detached. */ }
  await forgetDevice(tabId);
  return {ok:true};
}
async function screenshot(tabId) {
  const state = await readTabs();
  if (!state[String(tabId)]) throw new Error("ابتدا روی این تب شبیه‌سازی موبایل را فعال کنید.");
  const result = await chrome.debugger.sendCommand({tabId},"Page.captureScreenshot",{
    format:"png",captureBeyondViewport:false,fromSurface:true
  });
  if (!result || !result.data) throw new Error("تصویر دریافت نشد.");
  const tab = await chrome.tabs.get(tabId);
  let host = "website";
  try {host = new URL(tab.url).hostname.replace(/[^a-zA-Z0-9.-]/g,"_");} catch (_) {}
  const name = "responsive-studio/" + host + "-" + Date.now() + ".png";
  const downloadId = await chrome.downloads.download({
    url:"data:image/png;base64," + result.data,filename:name,saveAs:false
  });
  return {ok:true,downloadId};
}
function pageOverflowAudit() {
  const width = document.documentElement.clientWidth;
  const scrollWidth = Math.max(document.documentElement.scrollWidth,document.body ? document.body.scrollWidth : 0);
  const problematic = [];
  const nodes = document.body ? document.body.querySelectorAll("*") : [];
  for (const node of nodes) {
    if (problematic.length >= 25) break;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const css = getComputedStyle(node);
    if (css.position === "fixed" && box.width > width * 2) continue;
    if (box.right <= width + 2 && box.left >= -2) continue;
    let selector = node.tagName.toLowerCase();
    if (node.id) selector += "#" + CSS.escape(node.id);
    else if (typeof node.className === "string" && node.className.trim()) {
      selector += "." + node.className.trim().split(/\s+/).slice(0,2).map((v)=>CSS.escape(v)).join(".");
    }
    problematic.push({selector,right:Math.round(box.right),left:Math.round(box.left),elementWidth:Math.round(box.width)});
  }
  return {viewportWidth:width,documentWidth:scrollWidth,hasOverflow:scrollWidth>width+2,offenders:problematic};
}
async function audit(tabId) {
  const state = await readTabs();
  if (!state[String(tabId)]) throw new Error("ابتدا روی تب فعلی شبیه‌سازی موبایل را فعال کنید.");
  const result = await chrome.debugger.sendCommand({tabId},"Runtime.evaluate",{
    expression:"(" + pageOverflowAudit.toString() + ")()",
    returnByValue:true
  });
  if (result.exceptionDetails) throw new Error("بررسی صفحه ناموفق بود.");
  return {ok:true,report:result.result.value};
}

/* The Studio uses real browser tabs and Chrome DevTools screenshots.
 * This works for websites that prohibit being embedded in an iframe.
 * Preview tabs belong to their Studio tab and are closed with it.
 */
const STUDIO_TABS_KEY = "studioPreviewTabs";
let studioLock = Promise.resolve();

function studioExclusive(callback) {
  const next = studioLock.catch(() => {}).then(callback);
  studioLock = next.catch(() => {});
  return next;
}
async function getStudioTabs() {
  const result = await chrome.storage.session.get(STUDIO_TABS_KEY);
  return result[STUDIO_TABS_KEY] || {};
}
async function setStudioTabs(tabs) {
  await chrome.storage.session.set({[STUDIO_TABS_KEY]:tabs});
}
function studioSenderId(sender) {
  const url = String(sender && sender.url || "");
  if (!sender || !sender.tab || !Number.isInteger(sender.tab.id) ||
      !url.startsWith(chrome.runtime.getURL("studio.html"))) {
    throw new Error("درخواست پیش‌نمایش فقط از صفحه Studio پذیرفته می‌شود.");
  }
  return sender.tab.id;
}
function cleanPreviewKey(raw) {
  const key = String(raw || "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) throw new Error("شناسه دستگاه نامعتبر است.");
  return key;
}
async function studioEntry(sender,key) {
  const owner=studioSenderId(sender);
  const tabs=await getStudioTabs();
  const entry=tabs[String(owner)] && tabs[String(owner)][cleanPreviewKey(key)];
  if (!entry || !Number.isInteger(entry.tabId)) throw new Error("این پیش‌نمایش هنوز فعال نیست.");
  try { await chrome.tabs.get(entry.tabId); }
  catch (_) { throw new Error("تب پیش‌نمایش بسته شده است؛ سایت را دوباره بارگذاری کنید."); }
  return entry;
}
async function studioStart(sender,key,rawUrl,rawDevice) {
  const owner=studioSenderId(sender);
  const cleanKey=cleanPreviewKey(key);
  const url=sanitizeUrl(rawUrl);
  const device=sanitizeDevice(rawDevice);
  return studioExclusive(async()=>{
    const tabs=await getStudioTabs();
    const own=tabs[String(owner)] || {};
    let entry=own[cleanKey];
    if(entry){
      try {await chrome.tabs.get(entry.tabId);}
      catch (_) {entry=null;}
    }
    let tabId;
    if(entry){
      tabId=entry.tabId;
      await applyDevice(tabId,device);
      if(entry.url!==url) await chrome.tabs.update(tabId,{url});
    }else{
      const tab=await chrome.tabs.create({url,active:false,windowId:sender.tab.windowId});
      tabId=tab.id;
      try {
        await applyDevice(tabId,device);
        await chrome.debugger.sendCommand({tabId},"Page.enable");
      }catch(error){
        try {await chrome.tabs.remove(tabId);}catch(_){}
        throw error;
      }
    }
    own[cleanKey]={tabId,url,device};
    tabs[String(owner)]=own;
    await setStudioTabs(tabs);
    return {ok:true,tabId};
  });
}
async function studioShot(sender,key) {
  const entry=await studioEntry(sender,key);
  const result=await chrome.debugger.sendCommand({tabId:entry.tabId},"Page.captureScreenshot",{
    format:"jpeg",quality:65,fromSurface:true,captureBeyondViewport:false
  });
  if(!result || !result.data) throw new Error("تصویر از تب Chrome دریافت نشد.");
  return {ok:true,src:"data:image/jpeg;base64,"+result.data};
}
async function studioInput(sender,key,kind,data) {
  const entry=await studioEntry(sender,key);
  const device=entry.device;
  const width=device.landscape?device.height:device.width;
  const height=device.landscape?device.width:device.height;
  const x=Math.max(0,Math.min(width-1,Number(data.x)||0));
  const y=Math.max(0,Math.min(height-1,Number(data.y)||0));
  const target={tabId:entry.tabId};
  if(kind==="CLICK"){
    await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{type:"mouseMoved",x,y});
    await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
    await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
  }else if(kind==="SCROLL"){
    await chrome.debugger.sendCommand(target,"Input.dispatchMouseEvent",{
      type:"mouseWheel",x,y,deltaX:Math.max(-1200,Math.min(1200,Number(data.dx)||0)),
      deltaY:Math.max(-1200,Math.min(1200,Number(data.dy)||0))
    });
  }else if(kind==="TEXT"){
    const content=String(data.text||"");
    if(content.length>10) throw new Error("ورودی بیش‌ازحد طولانی است.");
    await chrome.debugger.sendCommand(target,"Input.insertText",{text:content});
  }else if(kind==="KEY"){
    const keyName=String(data.key||"");
    const codeMap={Enter:13,Backspace:8,Tab:9,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Delete:46,Escape:27};
    if(!Object.prototype.hasOwnProperty.call(codeMap,keyName))throw new Error("کلید پشتیبانی نمی‌شود.");
    for(const type of ["keyDown","keyUp"]){
      await chrome.debugger.sendCommand(target,"Input.dispatchKeyEvent",{
        type,key:keyName,code:keyName,windowsVirtualKeyCode:codeMap[keyName],nativeVirtualKeyCode:codeMap[keyName]
      });
    }
  }
  return {ok:true};
}
async function studioFocus(sender,key){
  const entry=await studioEntry(sender,key);
  await chrome.tabs.update(entry.tabId,{active:true});
  return {ok:true};
}
async function studioStop(sender,key) {
  const owner=studioSenderId(sender),cleanKey=cleanPreviewKey(key);
  return studioExclusive(async()=>{
    const tabs=await getStudioTabs();
    const own=tabs[String(owner)]||{};
    const entry=own[cleanKey];
    delete own[cleanKey];
    if(!Object.keys(own).length)delete tabs[String(owner)];
    else tabs[String(owner)]=own;
    await setStudioTabs(tabs);
    if(entry) {
      try { await chrome.debugger.detach({tabId:entry.tabId}); } catch(_){}
      try { await chrome.tabs.remove(entry.tabId); } catch(_){}
    }
    return {ok:true};
  });
}
async function studioRemoveTab(tabId) {
  await studioExclusive(async()=>{
    const tabs=await getStudioTabs();
    const childIds=[];
    let changed=false;
    if(tabs[String(tabId)]) {
      for(const entry of Object.values(tabs[String(tabId)]))childIds.push(entry.tabId);
      delete tabs[String(tabId)];
      changed=true;
    }
    for(const [owner,entries] of Object.entries(tabs)){
      for(const [key,entry] of Object.entries(entries)){
        if(entry.tabId===tabId){delete entries[key];changed=true;}
      }
      if(!Object.keys(entries).length){delete tabs[owner];changed=true;}
    }
    if(changed)await setStudioTabs(tabs);
    if(childIds.length) {
      try {await chrome.tabs.remove(childIds);} catch(_){}
    }
  });
}

chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  (async()=>{
    switch(message && message.type){
      case "PREVIEW_START":return await studioStart(sender,message.key,message.url,message.device);
      case "PREVIEW_SHOT":return await studioShot(sender,message.key);
      case "PREVIEW_CLICK":return await studioInput(sender,message.key,"CLICK",message);
      case "PREVIEW_SCROLL":return await studioInput(sender,message.key,"SCROLL",message);
      case "PREVIEW_TEXT":return await studioInput(sender,message.key,"TEXT",message);
      case "PREVIEW_KEY":return await studioInput(sender,message.key,"KEY",message);
      case "PREVIEW_FOCUS":return await studioFocus(sender,message.key);
      case "PREVIEW_STOP":return await studioStop(sender,message.key);
      case "OPEN_DEVICE":return await openDevice(message.url,message.device);
      case "APPLY_DEVICE":return await applyDevice(Number(message.tabId),message.device);
      case "CLEAR_DEVICE":return await clearDevice(Number(message.tabId));
      case "SCREENSHOT":return await screenshot(Number(message.tabId));
      case "AUDIT":return await audit(Number(message.tabId));
      case "GET_DEVICE": {
        const tabs=await readTabs();
        return {ok:true,device:tabs[String(message.tabId)]||null};
      }
      default:throw new Error("درخواست شناخته‌شده نیست.");
    }
  })().then(sendResponse).catch((error)=>sendResponse({ok:false,error:error && error.message || String(error)}));
  return true;
});
chrome.debugger.onDetach.addListener((source)=>{
  if (source.tabId != null) forgetDevice(source.tabId).catch(()=>{});
});
chrome.tabs.onRemoved.addListener((tabId)=>{
  forgetDevice(tabId).catch(()=>{});
});

chrome.tabs.onRemoved.addListener((tabId)=>{studioRemoveTab(tabId).catch(()=>{});});
