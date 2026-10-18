"use strict";
const $ = (id) => document.getElementById(id);
let currentTabId = null;
let activeDevice = null;
function show(message,isError=false){
  $("result").textContent = message;
  $("result").classList.toggle("error",isError);
}
function pickedDevice(){
  return {...getDevice($("device").value),mobile:$("device").value!=="desktop"};
}
function send(message){
  return chrome.runtime.sendMessage(message).then((response)=>{
    if(!response || !response.ok) throw new Error((response && response.error)||"عملیات ناموفق بود.");
    return response;
  });
}
async function run(button,callback){
  button.disabled=true;
  try{await callback();}
  catch(error){show(error.message||String(error),true);}
  finally{button.disabled=false;}
}
document.addEventListener("DOMContentLoaded",async()=>{
  $("device").replaceChildren(...DEVICE_PRESETS.map((device)=>{
    const option=document.createElement("option");
    option.value=device.id;
    option.textContent=device.name+" · "+device.width+" × "+device.height;
    return option;
  }));
  $("device").value="iphone-15";
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  const tab=tabs[0];
  currentTabId=tab && tab.id;
  const stored=await chrome.storage.local.get(["lastUrl","lastDevice"]);
  if(tab && /^https?:\/\//.test(tab.url||"")) $("url").value=tab.url;
  else if(stored.lastUrl) $("url").value=stored.lastUrl;
  if(getDevice(stored.lastDevice)) $("device").value=stored.lastDevice;
  if(currentTabId){
    const state=await send({type:"GET_DEVICE",tabId:currentTabId}).catch(()=>null);
    if(state && state.device){
      activeDevice=state.device;
      if(getDevice(activeDevice.id)) $("device").value=activeDevice.id;
      show("شبیه‌سازی "+activeDevice.name+" روی این تب فعال است.");
    }
  }
  $("apply").addEventListener("click",()=>run($("apply"),async()=>{
    if(!currentTabId) throw new Error("تب فعلی پیدا نشد.");
    const device=pickedDevice();
    const result=await send({type:"APPLY_DEVICE",tabId:currentTabId,device});
    activeDevice=result.device;
    await chrome.storage.local.set({lastDevice:device.id});
    show("✓ نمای "+device.name+" روی همین تب فعال شد.");
  }));
  $("open").addEventListener("click",()=>run($("open"),async()=>{
    const url=normalizeWebsiteUrl($("url").value);
    const device=pickedDevice();
    await chrome.storage.local.set({lastUrl:url,lastDevice:device.id});
    await send({type:"OPEN_DEVICE",url,device});
    show("✓ تب جدید با شبیه‌سازی "+device.name+" باز شد.");
  }));
  $("studio").addEventListener("click",()=>run($("studio"),async()=>{
    let url="";
    if($("url").value.trim()) url=normalizeWebsiteUrl($("url").value);
    if(url) await chrome.storage.local.set({lastUrl:url});
    await chrome.tabs.create({url:chrome.runtime.getURL("studio.html")+(url?"?url="+encodeURIComponent(url):"")});
    window.close();
  }));
  $("rotate").addEventListener("click",()=>run($("rotate"),async()=>{
    if(!currentTabId) throw new Error("تب فعلی پیدا نشد.");
    const device={...(activeDevice||pickedDevice())};
    device.landscape=!device.landscape;
    const state=await send({type:"APPLY_DEVICE",tabId:currentTabId,device});
    activeDevice=state.device;
    show("✓ صفحه به حالت "+(device.landscape?"افقی":"عمودی")+" چرخید.");
  }));
  $("clear").addEventListener("click",()=>run($("clear"),async()=>{
    if(!currentTabId) throw new Error("تب فعلی پیدا نشد.");
    await send({type:"CLEAR_DEVICE",tabId:currentTabId});
    activeDevice=null;
    show("✓ حالت شبیه‌سازی غیرفعال شد.");
  }));
  $("shot").addEventListener("click",()=>run($("shot"),async()=>{
    if(!currentTabId) throw new Error("تب فعلی پیدا نشد.");
    await send({type:"SCREENSHOT",tabId:currentTabId});
    show("✓ تصویر PNG در دانلودهای کروم ذخیره شد.");
  }));
  $("audit").addEventListener("click",()=>run($("audit"),async()=>{
    if(!currentTabId) throw new Error("تب فعلی پیدا نشد.");
    const result=await send({type:"AUDIT",tabId:currentTabId});
    const data=result.report;
    const summary="عرض نمایشگر: "+data.viewportWidth+"px | عرض سند: "+data.documentWidth+"px\n";
    const issues=data.offenders.map((item)=>item.selector+" (چپ "+item.left+" / راست "+item.right+")").join("\n");
    show(summary+(data.hasOverflow?"⚠ خروج افقی شناسایی شد.\n":"✓ خروج افقی سند شناسایی نشد.\n")+(issues?"موارد مشکوک:\n"+issues:""));
  }));
});
