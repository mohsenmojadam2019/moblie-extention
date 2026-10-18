"use strict";
const $ = (id) => document.getElementById(id);
const state = {
  url:"",
  scale:0.7,
  selected:DEFAULT_DEVICE_IDS.map((id)=>({key:id,device:{...getDevice(id)},landscape:false}))
};
const cards = new Map();
let toastTimer;
function toast(message,error=false){
  const node=$("toast");
  node.textContent=message;
  node.classList.toggle("error",error);
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>node.classList.remove("visible"),4200);
}
function isSelected(id){return state.selected.some((entry)=>entry.key===id);}
function persist(){
  const ids=state.selected.filter((entry)=>getDevice(entry.key)).map((entry)=>entry.key);
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
function toggleDevice(id){
  const index=state.selected.findIndex((entry)=>entry.key===id);
  if(index>=0){
    if(state.selected.length===1){toast("حداقل یک نمایشگر باید انتخاب شده باشد.",true);return;}
    state.selected.splice(index,1);
  }else{
    state.selected.push({key:id,device:{...getDevice(id)},landscape:false});
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
function createCard(entry){
  const card=document.createElement("article");
  card.className="device-card";
  card.dataset.key=entry.key;
  card.innerHTML='<div class="card-top"><div class="card-meta"><div class="card-label"><span class="mini-icon">▯</span><div><div class="card-name"></div><div class="card-dim"></div></div></div><button class="close-card" data-act="remove" title="حذف دستگاه" aria-label="حذف دستگاه">×</button></div><div class="card-actions"><button data-act="rotate" title="چرخش صفحه">↻ چرخش</button><button data-act="reload" title="بارگذاری مجدد">⟳ تازه‌سازی</button><button class="real-tab" data-act="open" title="نمایش واقعی با شبیه‌سازی Chrome">↗ تب واقعی</button></div></div><div class="viewport-holder"><div class="viewport-canvas"><div class="viewport-surface"><iframe loading="eager" title="پیش‌نمایش وب‌سایت"></iframe><div class="empty-preview"><div class="empty-shape">▯</div><b>آماده پیش‌نمایش</b><span>آدرس سایت را در بالا وارد کنید.</span></div></div></div></div><div class="card-foot"><span>WEB VIEWPORT</span><span>LIVE PREVIEW</span></div>';
  card.querySelector(".card-name").textContent=entry.device.name;
  card.querySelector("iframe").title="پیش‌نمایش "+entry.device.name;
  card.querySelectorAll("[data-act]").forEach((button)=>{
    button.addEventListener("click",()=>{
      const action=button.dataset.act;
      if(action==="remove") toggleOrRemove(entry.key);
      if(action==="rotate"){entry.landscape=!entry.landscape;updateCard(card,entry);}
      if(action==="reload") reloadCard(card);
      if(action==="open") openRealTab(entry,button);
    });
  });
  cards.set(entry.key,card);
  return card;
}
function toggleOrRemove(key){
  if(getDevice(key)){toggleDevice(key);return;}
  if(state.selected.length===1){toast("حداقل یک نمایشگر باید انتخاب شده باشد.",true);return;}
  state.selected=state.selected.filter((entry)=>entry.key!==key);
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
  card.querySelector(".empty-preview").hidden=Boolean(state.url);
  // 'hidden' may be overridden by .empty-preview display:flex in CSS.
  card.querySelector(".empty-preview").style.display=state.url?"none":"flex";
}
function reloadCard(card){
  const iframe=card.querySelector("iframe");
  if(state.url){
    iframe.src=state.url;
    toast("پیش‌نمایش مجدد بارگذاری شد.");
  }else toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);
}
async function openRealTab(entry,button){
  if(!state.url){toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);return;}
  button.disabled=true;
  try{
    const response=await chrome.runtime.sendMessage({
      type:"OPEN_DEVICE",url:state.url,
      device:{...entry.device,landscape:entry.landscape,mobile:entry.device.id!=="desktop"}
    });
    if(!response||!response.ok)throw new Error(response && response.error || "بازکردن تب ممکن نشد.");
    toast("تب واقعی "+entry.device.name+" باز شد. با کلیک افزونه می‌توانید اسکرین‌شات و گزارش بگیرید.");
  }catch(error){toast(error.message||String(error),true);}
  finally{button.disabled=false;}
}
function renderBoard(){
  const board=$("board");
  for(const [key,card] of cards){
    if(!state.selected.some((entry)=>entry.key===key)){
      card.remove();cards.delete(key);
    }
  }
  for(const entry of state.selected){
    let card=cards.get(entry.key);
    if(!card){
      card=createCard(entry);
      const frame=card.querySelector("iframe");
      if(state.url)frame.src=state.url;
    }
    updateCard(card,entry);
    board.appendChild(card);
  }
  $("count").textContent=String(state.selected.length);
}
async function loadUrl(){
  try{
    const url=normalizeWebsiteUrl($("site-url").value);
    state.url=url;
    $("site-url").value=url;
    await chrome.storage.local.set({lastUrl:url});
    for(const entry of state.selected){
      const frame=cards.get(entry.key)?.querySelector("iframe");
      if(frame)frame.src=url;
    }
    renderBoard();
    $("site-status").textContent="پیش‌نمایش "+new URL(url).hostname;
    toast("آدرس در همه نمایشگرها بارگذاری شد.");
  }catch(error){toast(error.message||String(error),true);}
}
document.addEventListener("DOMContentLoaded",async()=>{
  const saved=await chrome.storage.local.get(["lastUrl","selectedDevices"]);
  if(Array.isArray(saved.selectedDevices) && saved.selectedDevices.length){
    const valid=[...new Set(saved.selectedDevices)].filter((id)=>getDevice(id)).slice(0,10);
    if(valid.length)state.selected=valid.map((id)=>({key:id,device:{...getDevice(id)},landscape:false}));
  }
  const query=new URLSearchParams(window.location.search).get("url");
  $("site-url").value=query||saved.lastUrl||"";
  buildLibrary();renderBoard();
  $("site-form").addEventListener("submit",(event)=>{event.preventDefault();loadUrl();});
  $("reload-all").addEventListener("click",()=>{
    if(!state.url){toast("ابتدا آدرس وب‌سایت را وارد کنید.",true);return;}
    for(const card of cards.values())card.querySelector("iframe").src=state.url;
    toast("همه نمایشگرها نوسازی شدند.");
  });
  $("scale").addEventListener("change",()=>{
    state.scale=Number($("scale").value)||0.7;
    renderBoard();
  });
  $("add-custom").addEventListener("click",()=>{
    const width=Math.round(Number($("custom-width").value));
    const height=Math.round(Number($("custom-height").value));
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<240||width>2000||height<320||height>2200){
      toast("عرض ۲۴۰ تا ۲۰۰۰ و ارتفاع ۳۲۰ تا ۲۲۰۰ پیکسل مجاز است.",true);return;
    }
    const key="custom-"+Date.now();
    state.selected.push({key,device:{id:key,name:"Custom "+width+"×"+height,width,height,dpr:2,mobile:true},landscape:false});
    renderBoard();
    toast("نمایشگر سفارشی اضافه شد.");
  });
  if($("site-url").value.trim())loadUrl();
});
