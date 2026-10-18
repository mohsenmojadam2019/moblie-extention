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
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  (async()=>{
    switch(message && message.type){
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
