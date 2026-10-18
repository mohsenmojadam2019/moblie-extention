"use strict";
/*
 * Multi-device workspace. Each card controls an actual background Chrome tab.
 * Screenshots are requested from the extension debugger, never from iframes.
 */
const $=(id)=>document.getElementById(id);
const state={
  url:"",
  scale:0.7,
  selected:DEFAULT_DEVICE_IDS.map(id=>({key:id,device:{...getDevice(id)},landscape:false}))
};
const cards=new Map();
let toastTimer,revision=0,autoRefreshBusy=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function toast(message,error=false){
  const node=$("toast");
  node.textContent=message;
  node.classList.toggle("error",error);
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>node.classList.remove("visible"),4600);
}
async function send(message){
  const response=await chrome.runtime.sendMessage(message);
  if(!response || !response.ok)throw new Error(response&&response.error || "خطا در ارتباط با افزونه Chrome");
  return response;
}
function isSelected(id){return state.selected.some(entry=>entry.key===id);}
function persist(){
  const ids=state.selected.filter(entry=>getDevice(entry.key)).map(entry=>entry.key);
  chrome.storage.local.set({selectedDevices:ids}).catch(()=>{});
}
function buildLibrary(){
  const library=$("device-list");
  library.replaceChildren();
  let lastGroup="";
  for(const device of DEVICE_PRESETS){
    if(device.group!==lastGroup){
      const heading=document.createElement("div");
      heading.className="device-group";
      heading.textContent=device.group;
      library.append(heading);
      lastGroup=device.group;
    }
    const button=document.createElement("button");
    button.type="button";
    button.className="device-row"+(isSelected(device.id)?" active":"");
    button.dataset.id=device.id;
    button.setAttribute("aria-pressed",String(isSelected(device.id)));
    const glyph=device.group==="Tablet"?"▤":device.group==="Desktop"?"▣":"▯";
    button.innerHTML='<span class="device-svg">'+glyph+'</span><span class="device-detail"><span class="device-title"></span><span class="device-size"></span></span><span class="device-check"></span>';
    button.querySelector(".device-title").textContent=device.name;
    button.querySelector(".device-size").textContent=device.width+" × "+device.height;
    button.querySelector(".device-check").textContent=isSelected(device.id)?"✓":"+";
    button.addEventListener("click",()=>toggleDevice(device.id));
    library.append(button);
  }
}
function removePreview(key){
  cards.get(key)?.remove();
  cards.delete(key);
  send({type:"PREVIEW_STOP",key}).catch(()=>{});
}
function toggleDevice(id){
  const index=state.selected.findIndex(entry=>entry.key===id);
  if(index>=0){
    if(state.selected.length===1){toast("حداقل یک نمایشگر باید انتخاب شده باشد.",true);return;}
    state.selected.splice(index,1);
    removePreview(id);
  }else{
    const entry={key:id,device:{...getDevice(id)},landscape:false};
    state.selected.push(entry);
    if(state.url)startEntry(entry,revision);
  }
  persist();
  buildLibrary();
  renderBoard();
}
function effectiveSize(entry){
  return entry.landscape
    ?{width:entry.device.height,height:entry.device.width}
    :{width:entry.device.width,height:entry.device.height};
}
function setStatus(card,message,isError=false){
  const label=card.querySelector(".capture-status");
  label.textContent=message;
  label.classList.toggle("failed",isError);
  label.hidden=false;
  label.style.display="flex";
}
function hideStatus(card){
  const label=card.querySelector(".capture-status");
  label.hidden=true;
  label.style.display="none";
}
function pointerPosition(event,entry,element){
  const rect=element.getBoundingClientRect();
  const size=effectiveSize(entry);
  return {
    x:Math.round((event.clientX-rect.left)*size.width/rect.width),
    y:Math.round((event.clientY-rect.top)*size.height/rect.height)
  };
}
async function interact(entry,message){
  if(!state.url)return;
  try{
    await send({...message,key:entry.key});
    await sleep(message.type==="PREVIEW_CLICK"?850:300);
    await captureEntry(entry);
    if(message.type==="PREVIEW_CLICK"){
      await sleep(1300);
      await captureEntry(entry);
    }
  }catch(error){toast(error.message,true);}
}
function createCard(entry){
  const card=document.createElement("article");
  card.className="device-card";
  card.dataset.key=entry.key;
  card.innerHTML='<div class="card-top"><div class="card-meta"><div class="card-label"><span class="mini-icon">▯</span><div><div class="card-name"></div><div class="card-dim"></div></div></div><button class="close-card" data-act="remove" title="حذف دستگاه" aria-label="حذف دستگاه">×</button></div><div class="card-actions"><button data-act="rotate" title="چرخش صفحه">↻ چرخش</button><button data-act="reload" title="بازخوانی سایت">⟳ تازه‌سازی</button><button class="real-tab" data-act="open" title="انتقال به تب واقعی Chrome">↗ تب واقعی</button></div></div><div class="viewport-holder"><div class="viewport-canvas"><div class="viewport-surface" tabindex="0" role="application" aria-label="پیش‌نمایش قابل کلیک و اسکرول"><img class="capture-img" alt="تصویر سایت در مرورگر دستگاه" draggable="false"><div class="capture-status">در انتظار بارگذاری سایت</div></div></div></div><div class="card-foot"><span>REAL CHROME VIEW</span><span class="card-live">LIVE</span></div>';
  card.querySelector(".card-name").textContent=entry.device.name;
  const surface=card.querySelector(".viewport-surface");
  card.querySelectorAll("[data-act]").forEach(button=>{
    button.addEventListener("click",()=>{
      const action=button.dataset.act;
      if(action==="remove")toggleOrRemove(entry.key);
      if(action==="rotate"){
        entry.landscape=!entry.landscape;
        updateCard(card,entry);
        if(state.url)startEntry(entry,revision);
      }
      if(action==="reload")reloadCard(entry);
      if(action==="open")openRealTab(entry,button);
    });
  });
  surface.addEventListener("click",event=>{
    if(!state.url)return;
    surface.focus({preventScroll:true});
    interact(entry,{type:"PREVIEW_CLICK",...pointerPosition(event,entry,surface)});
  });
  surface.addEventListener("wheel",event=>{
    if(!state.url)return;
    event.preventDefault();
    const {x,y}=pointerPosition(event,entry,surface);
    if(entry.scrollPending)return;
    entry.scrollPending=true;
    interact(entry,{
      type:"PREVIEW_SCROLL",x,y,
      dx:Math.round(event.deltaX / state.scale),
      dy:Math.round(event.deltaY / state.scale)
    }).finally(()=>{entry.scrollPending=false;});
  },{passive:false});
  surface.addEventListener("keydown",event=>{
    if(!state.url || event.ctrlKey || event.metaKey || event.altKey)return;
    if(event.key.length===1){
      event.preventDefault();
      interact(entry,{type:"PREVIEW_TEXT",text:event.key});
    }else if(["Enter","Backspace","Tab","ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Delete","Escape"].includes(event.key)){
      event.preventDefault();
      interact(entry,{type:"PREVIEW_KEY",key:event.key});
    }
  });
  cards.set(entry.key,card);
  return card;
}
function toggleOrRemove(key){
  if(getDevice(key)){toggleDevice(key);return;}
  if(state.selected.length===1){toast("حداقل یک نمایشگر باید انتخاب شده باشد.",true);return;}
  state.selected=state.selected.filter(entry=>entry.key!==key);
  removePreview(key);
  renderBoard();
}
function updateCard(card,entry){
  const {width,height}=effectiveSize(entry);
  const zoom=state.scale;
  const canvas=card.querySelector(".viewport-canvas");
  const surface=card.querySelector(".viewport-surface");
  const holder=card.querySelector(".viewport-holder");
  const projectedWidth=Math.round(width*zoom);
  const projectedHeight=Math.round(height*zoom);
  card.style.width=Math.max(projectedWidth+28,270)+"px";
  canvas.style.width=projectedWidth+"px";
  canvas.style.height=projectedHeight+"px";
  surface.style.width=width+"px";
  surface.style.height=height+"px";
  surface.style.transform="scale("+zoom+")";
  holder.style.minHeight=(projectedHeight+26)+"px";
  card.querySelector(".card-dim").textContent=width+" × "+height+" CSS px · "+entry.device.dpr+"x";
  card.querySelector(".mini-icon").textContent=entry.landscape?"▱":"▯";
}
async function captureEntry(entry){
  const card=cards.get(entry.key);
  if(!card || !state.url || entry.capturing)return;
  entry.capturing=true;
  try{
    const result=await send({type:"PREVIEW_SHOT",key:entry.key});
    if(cards.get(entry.key)!==card)return;
    const image=card.querySelector(".capture-img");
    image.src=result.src;
    image.style.display="block";
    hideStatus(card);
    card.querySelector(".card-live").textContent="● LIVE";
  }catch(error){
    if(!card.querySelector(".capture-img").src){
      setStatus(card,"خطا در تصویر: "+error.message,true);
    }
    card.querySelector(".card-live").textContent="⚠ RETRY";
  }finally{entry.capturing=false;}
}
async function startEntry(entry,version,reload=false){
  const card=cards.get(entry.key);
  if(!card || !state.url)return;
  const image=card.querySelector(".capture-img");
  if(reload || !image.src)setStatus(card,"در حال دریافت تصویر از Chrome...");
  entry.starting=true;
  try{
    await send({type:"PREVIEW_START",key:entry.key,url:state.url,
      device:{...entry.device,landscape:entry.landscape,mobile:entry.device.id!=="desktop"},
      reload
    });
    if(version!==revision || !state.selected.includes(entry))return;
    await sleep(750);
    await captureEntry(entry);
  }catch(error){
    if(version===revision && state.selected.includes(entry))setStatus(card,"خطا: "+error.message,true);
  }finally{entry.starting=false;}
}
function reloadCard(entry){
  if(!state.url){toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);return;}
  const card=cards.get(entry.key);
  if(card){card.querySelector(".capture-img").removeAttribute("src");setStatus(card,"در حال تازه‌سازی سایت...");}
  startEntry(entry,revision,true);
}
async function openRealTab(entry,button){
  if(!state.url){toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);return;}
  button.disabled=true;
  try{
    // Activate the very same tab backing the screenshot; no duplicate tabs.
    await send({type:"PREVIEW_FOCUS",key:entry.key});
    toast("تب واقعی "+entry.device.name+" باز شد. پس از بازگشت به Studio، پیش‌نمایش به‌روزرسانی می‌شود.");
  }catch(error){toast(error.message,true);}
  finally{button.disabled=false;}
}
function renderBoard(){
  const board=$("board");
  for(const [key,card] of cards){
    if(!state.selected.some(entry=>entry.key===key)){card.remove();cards.delete(key);}
  }
  for(const entry of state.selected){
    let card=cards.get(entry.key);
    if(!card)card=createCard(entry);
    updateCard(card,entry);
    board.appendChild(card);
  }
  $("count").textContent=String(state.selected.length);
}
async function loadUrl(){
  try{
    const url=normalizeWebsiteUrl($("site-url").value);
    const changed=url!==state.url;
    state.url=url;
    revision++;
    const version=revision;
    $("site-url").value=url;
    await chrome.storage.local.set({lastUrl:url});
    $("site-status").textContent="مرورگر واقعی: "+new URL(url).hostname;
    if(changed){
      for(const card of cards.values()){
        card.querySelector(".capture-img").removeAttribute("src");
        setStatus(card,"در حال بازکردن سایت در Chrome...");
      }
    }
    const tasks=state.selected.map(entry=>startEntry(entry,version,changed));
    await Promise.allSettled(tasks);
    toast("نمایشگرها آماده‌اند. برای پیمایش داخل هر تصویر، از اسکرول و کلیک استفاده کنید.");
  }catch(error){toast(error.message||String(error),true);}
}
document.addEventListener("DOMContentLoaded",async()=>{
  const saved=await chrome.storage.local.get(["lastUrl","selectedDevices"]);
  if(Array.isArray(saved.selectedDevices)&&saved.selectedDevices.length){
    const valid=[...new Set(saved.selectedDevices)].filter(id=>getDevice(id)).slice(0,10);
    if(valid.length)state.selected=valid.map(id=>({key:id,device:{...getDevice(id)},landscape:false}));
  }
  const query=new URLSearchParams(window.location.search).get("url");
  $("site-url").value=query||saved.lastUrl||"";
  buildLibrary();renderBoard();
  $("site-form").addEventListener("submit",event=>{event.preventDefault();loadUrl();});
  $("reload-all").addEventListener("click",()=>{
    if(!state.url){toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);return;}
    for(const entry of state.selected)reloadCard(entry);
    toast("بازخوانی تمام دستگاه‌ها آغاز شد.");
  });
  $("scale").addEventListener("change",()=>{
    state.scale=Number($("scale").value)||.7;
    renderBoard();
  });
  $("add-custom").addEventListener("click",()=>{
    const width=Math.round(Number($("custom-width").value));
    const height=Math.round(Number($("custom-height").value));
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<240||width>2000||height<320||height>2200){
      toast("عرض ۲۴۰ تا ۲۰۰۰ و ارتفاع ۳۲۰ تا ۲۲۰۰ پیکسل مجاز است.",true);return;
    }
    const key="custom-"+Date.now();
    const entry={key,device:{id:key,name:"Custom "+width+"×"+height,width,height,dpr:2,mobile:true},landscape:false};
    state.selected.push(entry);
    renderBoard();
    if(state.url)startEntry(entry,revision);
    toast("نمایشگر سفارشی اضافه شد.");
  });
  // Chrome DevTools capture is used only while the Studio page is visible.
  // A slow interval avoids continuously reloading data-heavy websites.
  setInterval(async()=>{
    if(document.hidden || autoRefreshBusy || !state.url)return;
    autoRefreshBusy=true;
    try{
      await Promise.allSettled(state.selected.filter(e=>!e.starting).map(captureEntry));
    }finally{autoRefreshBusy=false;}
  },4500);
  if($("site-url").value.trim())loadUrl();
});
