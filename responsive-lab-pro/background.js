/* MV3 service worker: all emulation lives in the target browser tab, not an iframe. */
const sessions = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const validTab = (tab) => Boolean(tab && /^https?:\/\//.test(tab.url || ''));
const channel = (tabId) => ({tabId});
const notify = (type, payload) => chrome.runtime.sendMessage({type, ...payload}).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(console.error);
});
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId != null) {
    sessions.delete(source.tabId);
    notify('SESSION_DETACHED', {tabId:source.tabId, reason});
  }
});
chrome.tabs.onRemoved.addListener((tabId) => sessions.delete(tabId));

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

function normalizeMetrics(data) {
  const width=Number(data.width),height=Number(data.height),dpr=Number(data.dpr);
  if (!Number.isInteger(width) || width<240 || width>2560 || !Number.isInteger(height) || height<320 || height>2560 || !Number.isFinite(dpr) || dpr<0.5 || dpr>5) {
    throw new Error('ابعاد باید بین ۲۴۰ تا ۲۵۶۰ و DPR بین ۰.۵ تا ۵ باشد.');
  }
  const platform = ['ios','android','desktop'].includes(data.platform) ? data.platform : 'android';
  return {width,height,dpr,platform,landscape:Boolean(data.landscape),name:String(data.name || 'سفارشی').slice(0,80)};
}
async function attach(tabId) {
  if (sessions.has(tabId)) return;
  const targets = await chrome.debugger.getTargets();
  if (targets.some(t=>t.tabId===tabId && t.attached)) {
    throw new Error('DevTools یا ابزار Debugger دیگری به این تب متصل است. ابتدا آن را ببندید.');
  }
  await chrome.debugger.attach(channel(tabId),'1.3');
  sessions.set(tabId,{width:390,height:844,dpr:3,platform:'android',name:'موبایل',landscape:false});
}
async function emulate(tabId,config) {
  const tab=await chrome.tabs.get(tabId);
  if (!validTab(tab)) throw new Error('فقط صفحات عادی HTTP/HTTPS پشتیبانی می‌شوند.');
  const metrics=normalizeMetrics(config);
  await attach(tabId);
  const source=channel(tabId);
  const width=metrics.landscape?metrics.height:metrics.width;
  const height=metrics.landscape?metrics.width:metrics.height;
  try {
    await chrome.debugger.sendCommand(source,'Emulation.setDeviceMetricsOverride',{
      width,height,deviceScaleFactor:metrics.dpr,mobile:metrics.platform!=='desktop',
      screenWidth:width,screenHeight:height,
      screenOrientation:{type:metrics.landscape?'landscapePrimary':'portraitPrimary',angle:metrics.landscape?90:0}
    });
    await chrome.debugger.sendCommand(source,'Emulation.setTouchEmulationEnabled',{
      enabled:metrics.platform!=='desktop',maxTouchPoints:5
    });
    if (metrics.platform!=='desktop') {
      await chrome.debugger.sendCommand(source,'Emulation.setUserAgentOverride',{
        userAgent:metrics.platform==='ios'?IOS_UA:ANDROID_UA,
        platform:metrics.platform==='ios'?'iPhone':'Android',
        acceptLanguage:'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7'
      });
    } else {
      await chrome.debugger.sendCommand(source,'Emulation.setUserAgentOverride',{userAgent:''});
    }
  } catch(e) {
    await chrome.debugger.detach(source).catch(()=>{});
    sessions.delete(tabId);
    throw e;
  }
  sessions.set(tabId,metrics);
  return {attached:true,config:metrics};
}
async function disable(tabId) {
  if (!sessions.has(tabId)) return {attached:false};
  await chrome.debugger.detach(channel(tabId));
  sessions.delete(tabId);
  return {attached:false};
}
async function sendContent(tabId,message) {
  try {return await chrome.tabs.sendMessage(tabId,message);}
  catch(e) {
    if (/Receiving end does not exist|Could not establish connection/.test(String(e))) {
      await chrome.scripting.executeScript({target:{tabId},files:['content.js']});
      return await chrome.tabs.sendMessage(tabId,message);
    }
    throw e;
  }
}
async function audit(tabId) {return sendContent(tabId,{type:'AUDIT'});}
async function sweep(tabId, widths) {
  const original=sessions.get(tabId);
  if (!original) throw new Error('ابتدا شبیه‌سازی را فعال کنید.');
  const values=[...new Set(widths.map(Number).filter(v=>Number.isInteger(v)&&v>=240&&v<=2560))].slice(0,16);
  if (!values.length) throw new Error('لیست عرض معتبر نیست.');
  const results=[];
  try {
    for (let i=0;i<values.length;i++) {
      const width=values[i];
      await emulate(tabId,{...original,landscape:false,width,height:original.height});
      await pause(350);
      const report=await audit(tabId);
      results.push({width,...report});
      notify('SWEEP_PROGRESS',{tabId,index:i+1,total:values.length,width});
    }
  } finally {
    await emulate(tabId,original).catch(()=>{});
  }
  return results;
}
async function screenshot(tabId) {
  if (!sessions.has(tabId)) throw new Error('ابتدا حالت شبیه‌سازی را فعال کنید.');
  const result=await chrome.debugger.sendCommand(channel(tabId),'Page.captureScreenshot',{
    format:'png',captureBeyondViewport:false,fromSurface:true
  });
  const tab=await chrome.tabs.get(tabId);
  const label=(new URL(tab.url)).hostname.replace(/[^a-z0-9.-]/gi,'_');
  const time=new Date().toISOString().replace(/[:.]/g,'-');
  const filename=`Responsive-Lab/${label}-${time}.png`;
  const downloadId=await chrome.downloads.download({url:`data:image/png;base64,${result.data}`,filename,saveAs:false});
  return {downloadId,filename};
}
chrome.runtime.onMessage.addListener((request,sender,respond)=>{
  if (!request || request.type==='ELEMENT_PICKED' || request.type==='SWEEP_PROGRESS' || request.type==='SESSION_DETACHED') return false;
  const tabId=Number(request.tabId);
  if (!Number.isInteger(tabId) || tabId<0) {respond({ok:false,error:'تب معتبر نیست.'});return false;}
  (async()=>{
    switch(request.type){
      case 'STATUS': return {attached:sessions.has(tabId),config:sessions.get(tabId)||null};
      case 'EMULATE': return emulate(tabId,request.config);
      case 'DISABLE': return disable(tabId);
      case 'START_PICK': return sendContent(tabId,{type:'START_PICK'});
      case 'STOP_PICK': return sendContent(tabId,{type:'STOP_PICK'});
      case 'SET_STYLE': return sendContent(tabId,{type:'SET_STYLE',property:request.property,value:request.value});
      case 'SET_STYLES': return sendContent(tabId,{type:'SET_STYLES',styles:request.styles});
      case 'UNDO': return sendContent(tabId,{type:'UNDO'});
      case 'RESET_STYLES': return sendContent(tabId,{type:'RESET_STYLES'});
      case 'GET_SELECTED': return sendContent(tabId,{type:'GET_SELECTED'});
      case 'SAVE_STYLE': return sendContent(tabId,{type:'SAVE_STYLE'});
      case 'AUDIT': return audit(tabId);
      case 'SWEEP': return sweep(tabId,request.widths||[]);
      case 'SCREENSHOT': return screenshot(tabId);
      default: throw new Error(`دستور ناشناخته: ${request.type}`);
    }
  })().then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,error:e.message||String(e)}));
  return true;
});
