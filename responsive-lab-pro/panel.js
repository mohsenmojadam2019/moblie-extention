/* Side-panel application. No frameworks, eval, trackers or remote dependencies. */
const $=(sel)=>document.querySelector(sel);
const $$=(sel)=>[...document.querySelectorAll(sel)];
const RULES_KEY='responsiveLabRulesV1';
let tabId=null,siteOrigin=null,lastAudit=null,lastSweep=[],lastSelection=null;
let landscape=false,platform='ios',deviceName='iPhone 14',busy=false;
const colors={};
function notify(message,type='info'){
  const el=$('#notice');el.textContent=message;el.className=`notice show ${type}`;
  clearTimeout(notify.timer);notify.timer=setTimeout(()=>{el.className='notice';},5500);
}
function setBusy(value){busy=value;$$('button').forEach(b=>{if(!b.closest('.tabs'))b.disabled=value;});}
async function target(){
  const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  const tab=tabs[0];
  if(!tab||!/^https?:\/\//.test(tab.url||''))throw new Error('یک صفحه HTTP/HTTPS را در Chrome باز کنید.');
  tabId=tab.id;siteOrigin=new URL(tab.url).origin;
  $('#site').textContent=new URL(tab.url).host;
  return tabId;
}
async function call(type,extra={}){
  await target();
  const response=await chrome.runtime.sendMessage({type,tabId,...extra});
  if(!response?.ok)throw new Error(response?.error||'خطا در ارتباط با افزونه');
  if(response.data?.error)throw new Error(response.data.error);
  return response.data;
}
async function perform(action,success){
  if(busy)return;
  setBusy(true);
  try {const out=await action();if(success)notify(success,'success');return out;}
  catch(e){notify(e.message||String(e),'error');return null;}
  finally {setBusy(false);}
}
function renderStatus(result){
  const on=Boolean(result?.attached);$('#status').textContent=on?'شبیه‌سازی فعال':'غیرفعال';
  $('#status-dot').classList.toggle('on',on);
  if(on && result.config){
    const x=result.config;
    $('#width').value=x.width;$('#height').value=x.height;$('#dpr').value=x.dpr;
    platform=x.platform;landscape=Boolean(x.landscape);setOrientation();
  }
}
function setOrientation(){
  $$('.orientation').forEach(el=>el.classList.toggle('active',(el.dataset.orientation==='landscape')===landscape));
}
function selectDevice(id){
  const d=DEVICE_PRESETS.find(x=>x.id===id);
  if(!d)return;
  $('#width').value=d.width;$('#height').value=d.height;$('#dpr').value=d.dpr;
  platform=d.platform;deviceName=d.name;landscape=false;setOrientation();
}
function collect(){
  return {width:Number($('#width').value),height:Number($('#height').value),dpr:Number($('#dpr').value),platform,landscape,name:deviceName};
}
function renderSelection(info){
  lastSelection=info;
  const el=$('#selection');$('#computed').replaceChildren();
  if(!info){el.textContent='هنوز المانی انتخاب نشده است. دکمه بالا را بزنید و یک بخش از سایت را انتخاب کنید.';el.className='selection';return;}
  el.className='selection found';el.replaceChildren();
  const code=document.createElement('code');code.textContent=info.selector;
  const size=document.createElement('div');size.textContent=`${info.tag} • ${info.size.width} × ${info.size.height} px`;
  el.append(code,size);
  for(const prop of ['display','position','font-size','max-width']){
    const chip=document.createElement('span');chip.textContent=`${prop}: ${info.values[prop]||'-'}`;$('#computed').append(chip);
  }
}
function parseDeclarations(value){
  const styles={};
  for(const declaration of value.split(/;|\n/)){
    const colon=declaration.indexOf(':');if(colon<1)continue;
    const key=declaration.slice(0,colon).trim().toLowerCase();
    const val=declaration.slice(colon+1).trim();
    if(/^([a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)$/.test(key)&&val)styles[key]=val;
  }
  return styles;
}
function collectStyles(){
  const styles={};$$('[data-css]').forEach(input=>{if(input.value.trim())styles[input.dataset.css]=input.value.trim();});
  return {...styles,...parseDeclarations($('#css-text').value)};
}
function renderSingleReport(report,header){
  const card=document.createElement('div');card.className='audit-card';
  const strong=document.createElement('strong');strong.textContent=header||`${report.viewport.width}px`;
  const right=document.createElement('span');right.className='right';right.textContent=`${report.checkedElements} elements`;
  card.append(strong,right);
  const issues=report.overflow.length+report.smallTargets.length+report.clipped.length+Number(report.missingViewportMeta);
  const severity=document.createElement('div');severity.className='severity '+(issues||report.horizontalOverflow?'fail':'ok');
  severity.textContent=issues||report.horizontalOverflow?`⚠ ${issues} مورد احتمالی • overflow: ${report.horizontalOverflow?'بله':'خیر'}`:'✓ مورد مشکوک در بررسی اولیه مشاهده نشد';
  card.append(severity);
  const list=document.createElement('ul');
  const add=(text)=>{const li=document.createElement('li');li.textContent=text;list.append(li);};
  if(report.missingViewportMeta)add('Missing meta[name="viewport"]');
  if(report.horizontalOverflow)add(`Document overflow: ${report.documentWidth} > ${report.viewport.width}`);
  report.overflow.slice(0,8).forEach(item=>add(`Overflow: ${item.selector} (right=${item.right}px)`));
  report.smallTargets.slice(0,5).forEach(item=>add(`Small tap target: ${item.selector} (${item.width}×${item.height})`));
  report.clipped.slice(0,4).forEach(item=>add(`Clipped content: ${item.selector}`));
  if(list.childNodes.length)card.append(list);
  return card;
}
function downloadText(name,contents,type){
  const file=new Blob([contents],{type});const url=URL.createObjectURL(file);
  const link=document.createElement('a');link.href=url;link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
async function getRules(){const s=await chrome.storage.local.get(RULES_KEY);return s[RULES_KEY]||{};}
async function saveRule(){
  const {selector,styles,url}=await call('SAVE_STYLE');
  const rules=await getRules(),items=Array.isArray(rules[url])?rules[url]:[];
  const idx=items.findIndex(x=>x.selector===selector);
  if(idx>=0)items[idx]={selector,styles:{...items[idx].styles,...styles}};
  else items.push({selector,styles});
  rules[url]=items.slice(-200);
  await chrome.storage.local.set({[RULES_KEY]:rules});
  return true;
}
function makeCSS(items){
  return items.map(({selector,styles})=>`${selector} {\n${Object.entries(styles||{}).map(([k,v])=>`  ${k}: ${v} !important;`).join('\n')}\n}`).join('\n\n')+'\n';
}
function setTabs(){
  $$('.tabs button').forEach(button=>button.addEventListener('click',()=>{
    $$('.tabs button').forEach(b=>b.classList.toggle('selected',b===button));
    $$('.tabpage').forEach(page=>page.classList.toggle('hidden',page.dataset.page!==button.dataset.tab));
  }));
}
function wire(){
  $('#device').addEventListener('change',e=>selectDevice(e.target.value));
  $$('.orientation').forEach(button=>button.addEventListener('click',()=>{landscape=button.dataset.orientation==='landscape';setOrientation();}));
  $('#apply').addEventListener('click',()=>perform(async()=>{
    const r=await call('EMULATE',{config:collect()});renderStatus(r);
  },'شبیه‌سازی موبایل / تبلت فعال شد.'));
  $('#disable').addEventListener('click',()=>perform(async()=>{const r=await call('DISABLE');renderStatus(r);},'ابعاد تب به حالت عادی برگشت.'));
  $('#pick').addEventListener('click',()=>perform(()=>call('START_PICK'),'اکنون روی المان موردنظر در صفحه کلیک کنید.'));
  $('#apply-css').addEventListener('click',()=>perform(async()=>{
    const styles=collectStyles();if(!Object.keys(styles).length)throw Error('حداقل یک ویژگی CSS وارد کنید.');
    const info=await call('SET_STYLES',{styles});renderSelection(info);
  },'استایل روی المان اعمال شد.'));
  $('#undo').addEventListener('click',()=>perform(async()=>{renderSelection(await call('UNDO'));},'آخرین تغییر بازگردانده شد.'));
  $('#reset-css').addEventListener('click',()=>perform(async()=>{renderSelection(await call('RESET_STYLES'));},'تغییرات زنده این المان پاک شد.'));
  $('#save-css').addEventListener('click',()=>perform(saveRule,'استایل برای این دامنه ذخیره شد.'));
  $('#audit').addEventListener('click',()=>perform(async()=>{
    lastAudit=await call('AUDIT');lastSweep=[];
    $('#audit-results').replaceChildren(renderSingleReport(lastAudit,'عرض فعلی'));
  },'بررسی ریسپانسیو انجام شد.'));
  $('#sweep').addEventListener('click',()=>perform(async()=>{
    $('#progress').classList.remove('hidden');$('#progress').textContent='شروع اسکن...';
    try {lastSweep=await call('SWEEP',{widths:QUICK_WIDTHS});lastAudit=null;
      $('#audit-results').replaceChildren(...lastSweep.map(r=>renderSingleReport(r,`${r.width}px`)));
    } finally {$('#progress').classList.add('hidden');}
  },'اسکن عرض‌های متداول به پایان رسید.'));
  $('#screenshot').addEventListener('click',()=>perform(()=>call('SCREENSHOT'),'اسکرین‌شات در پوشه Downloads ذخیره شد.'));
  $('#export-json').addEventListener('click',()=>perform(async()=>{
    if(!lastAudit&&!lastSweep.length)throw Error('ابتدا یک اسکن انجام دهید.');
    downloadText('responsive-audit.json',JSON.stringify({url:siteOrigin,report:lastAudit,sweep:lastSweep,created:new Date().toISOString()},null,2),'application/json');
  },'گزارش JSON دانلود شد.'));
  $('#export-css').addEventListener('click',()=>perform(async()=>{
    await target();const rules=await getRules(),items=rules[siteOrigin]||[];
    if(!items.length)throw Error('هنوز استایل ذخیره‌شده‌ای برای این سایت وجود ندارد.');
    downloadText('responsive-overrides.css',makeCSS(items),'text/css');
  },'فایل CSS دانلود شد.'));
  $('#copy-selector').addEventListener('click',()=>perform(async()=>{
    if(!lastSelection?.selector)throw Error('ابتدا المانی انتخاب کنید.');
    await navigator.clipboard.writeText(lastSelection.selector);
  },'سلکتور کپی شد.'));
  setTabs();
  chrome.runtime.onMessage.addListener((msg)=>{
    if(msg.type==='ELEMENT_PICKED'){
      renderSelection(msg.details);
      $$('.tabs button')[0].click();notify('المان انتخاب شد؛ اکنون CSS را ویرایش کنید.','success');
    }
    if(msg.type==='SWEEP_PROGRESS'&&msg.tabId===tabId){$('#progress').textContent=`در حال بررسی ${msg.index} از ${msg.total} • عرض ${msg.width}px`;}
    if(msg.type==='SESSION_DETACHED'&&msg.tabId===tabId){renderStatus({attached:false});notify('اتصال شبیه‌ساز قطع شد؛ احتمالاً DevTools باز شده است.','error');}
  });
  chrome.tabs.onActivated.addListener(()=>refresh());
  chrome.tabs.onUpdated.addListener((id,info)=>{if(id===tabId&&info.status==='complete')refresh();});
}
async function refresh(){
  try{await target();renderStatus(await call('STATUS'));renderSelection(await call('GET_SELECTED'));}
  catch(e){$('#site').textContent='صفحه پشتیبانی نمی‌شود';$('#status').textContent='غیرفعال';$('#status-dot').classList.remove('on');}
}
function boot(){
  const select=$('#device'),groups=new Map();
  for(const d of DEVICE_PRESETS){
    if(!groups.has(d.group)){const opt=document.createElement('optgroup');opt.label=d.group;select.append(opt);groups.set(d.group,opt);}
    const option=document.createElement('option');option.value=d.id;option.textContent=d.name;
    groups.get(d.group).append(option);
  }
  select.value='iphone-14';selectDevice('iphone-14');
  for(const width of QUICK_WIDTHS){
    const b=document.createElement('button');b.textContent=`${width}`;b.title=`${width}px`;
    b.addEventListener('click',()=>{const current=collect();$('#width').value=width;$('#device').value='';deviceName=`Custom ${width}px`;});
    $('#quick').append(b);
  }
  wire();refresh();
}
boot();
