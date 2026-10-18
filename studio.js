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
    // Wait until its card exists before starting the background tab.
  }
  persist();
  buildLibrary();
  renderBoard();
  if(index<0 && state.url)startEntry(state.selected[state.selected.length-1],revision);
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

function updateScrollControls(entry,info){
  const card=cards.get(entry.key);
  if(!card || !info)return;
  const percent=Math.min(100,Math.max(0,Math.round(Number(info.percent)||0)));
  if(info.kind==="document" || info.kind==="nested"){
    const slider=card.querySelector(".scroll-range");
    if(document.activeElement!==slider)slider.value=String(percent);
    card.querySelector(".scroll-percent").textContent=percent+"%";
    card.querySelector(".scroll-pos").textContent=info.max>0
      ?("موقعیت "+Math.round(info.top)+" از "+Math.round(info.max)+"px"):"ابتدای صفحه";
  }
}
function normalizedWheelDelta(event,entry){
  const height=effectiveSize(entry).height;
  const factor=event.deltaMode===1?42:event.deltaMode===2?height:1;
  return {dx:Math.round(event.deltaX*factor / state.scale),
    dy:Math.round(event.deltaY*factor / state.scale)};
}
function enqueueScroll(entry,dx,dy,coords){
  if(!state.url)return;
  entry.queuedDx=(entry.queuedDx||0)+dx;
  entry.queuedDy=(entry.queuedDy||0)+dy;
  entry.lastPointer=coords||entry.lastPointer;
  if(entry.scrollWorker)return;
  entry.scrollWorker=(async()=>{
    try {
      while(Math.abs(entry.queuedDx)>0.5||Math.abs(entry.queuedDy)>0.5){
        const nextDx=Math.max(-1300,Math.min(1300,Math.round(entry.queuedDx)));
        const nextDy=Math.max(-1800,Math.min(1800,Math.round(entry.queuedDy)));
        entry.queuedDx-=nextDx;
        entry.queuedDy-=nextDy;
        const {x,y}=entry.lastPointer||{x:effectiveSize(entry).width/2,y:effectiveSize(entry).height/2};
        const result=await send({type:"PREVIEW_SCROLL",key:entry.key,x,y,dx:nextDx,dy:nextDy});
        updateScrollControls(entry,result.scroll);
        // Allow layout, lazy-loaded sections and fixed headers to settle.
        await sleep(180);
        await captureEntry(entry);
      }
    }catch(error){toast("خطای پیمایش "+entry.device.name+": "+error.message,true);}
    finally{
      entry.scrollWorker=null;
      if(Math.abs(entry.queuedDy)>0.5||Math.abs(entry.queuedDx)>0.5)
        enqueueScroll(entry,0,0,entry.lastPointer);
    }
  })();
}
async function jumpScroll(entry,action,percent){
  if(!state.url){toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);return;}
  try{
    entry.queuedDy=0;entry.queuedDx=0;
    if(entry.scrollWorker)await entry.scrollWorker;
    const response=await send({type:"PREVIEW_SCROLL_TO",key:entry.key,action,percent});
    updateScrollControls(entry,response.scroll);
    await sleep(200);
    await captureEntry(entry);
  }catch(error){toast("خطای جابه‌جایی "+entry.device.name+": "+error.message,true);}
}
async function updatePosition(entry){
  try{
    const response=await send({type:"PREVIEW_SCROLL_STATUS",key:entry.key});
    updateScrollControls(entry,response.scroll);
  }catch(_){}
}

function createCard(entry){
  const card=document.createElement("article");
  card.className="device-card";
  card.dataset.key=entry.key;
  card.innerHTML='<div class="card-top"><div class="card-meta"><div class="card-label"><span class="mini-icon">▯</span><div><div class="card-name"></div><div class="card-dim"></div></div></div><button class="close-card" data-act="remove" title="حذف دستگاه" aria-label="حذف دستگاه">×</button></div><div class="card-actions"><button data-act="rotate" title="چرخش صفحه">↻ چرخش</button><button data-act="reload" title="بازخوانی سایت">⟳ تازه‌سازی</button><button class="real-tab" data-act="open" title="انتقال به تب واقعی Chrome">↗ تب واقعی</button></div></div><div class="viewport-holder"><div class="viewport-canvas"><div class="viewport-surface" tabindex="0" role="application" aria-label="پیش‌نمایش قابل کلیک و اسکرول"><img class="capture-img" alt="تصویر سایت در مرورگر دستگاه" draggable="false"><div class="capture-status">در انتظار بارگذاری سایت</div></div></div></div><div class="scroll-toolbar"><button type="button" data-scroll="top" title="ابتدای سایت">↑ بالا</button><input class="scroll-range" type="range" min="0" max="100" value="0" step="1" aria-label="موقعیت عمودی صفحه"><button type="button" data-scroll="bottom" title="انتهای سایت">↓ پایین</button><span class="scroll-percent">0%</span></div><div class="card-foot"><span class="scroll-pos">موقعیت صفحه</span><span class="card-live">LIVE</span></div>';
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
  for(const button of card.querySelectorAll("[data-scroll]")){
    button.addEventListener("click",()=>jumpScroll(entry,button.dataset.scroll,0));
  }
  const slider=card.querySelector(".scroll-range");
  slider.addEventListener("change",()=>jumpScroll(entry,"percent",Number(slider.value)));
  let pointerStart=null;
  surface.addEventListener("pointerdown",event=>{
    if(event.button!==0 || !state.url)return;
    pointerStart={id:event.pointerId,x:event.clientX,y:event.clientY};
    surface.setPointerCapture(event.pointerId);
  });
  surface.addEventListener("pointerup",event=>{
    if(!pointerStart || pointerStart.id!==event.pointerId)return;
    const deltaY=pointerStart.y-event.clientY;
    const deltaX=pointerStart.x-event.clientX;
    if(Math.abs(deltaY)>10 || Math.abs(deltaX)>10){
      entry.suppressClick=true;
      enqueueScroll(entry,
        Math.round(deltaX / state.scale),Math.round(deltaY / state.scale),
        pointerPosition(event,entry,surface));
    }
    pointerStart=null;
  });
  surface.addEventListener("pointercancel",()=>{pointerStart=null;});
  surface.addEventListener("click",event=>{
    if(!state.url)return;
    if(entry.suppressClick){entry.suppressClick=false;return;}
    surface.focus({preventScroll:true});
    interact(entry,{type:"PREVIEW_CLICK",...pointerPosition(event,entry,surface)});
  });
  surface.addEventListener("wheel",event=>{
    if(!state.url)return;
    event.preventDefault();
    const coords=pointerPosition(event,entry,surface);
    const delta=normalizedWheelDelta(event,entry);
    enqueueScroll(entry,delta.dx,delta.dy,coords);
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
  if(!card || !state.url)return;
  if(entry.capturing){entry.needsCapture=true;return;}
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
  }finally{
    entry.capturing=false;
    if(entry.needsCapture){
      entry.needsCapture=false;
      captureEntry(entry).catch(()=>{});
    }
  }
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
    await updatePosition(entry);
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
    toast("اسکرول موس، کشیدن تصویر و کنترل‌های بالا/پایین برای هر گوشی جداگانه فعال هستند.");
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
