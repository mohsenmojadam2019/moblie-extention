"use strict";
const DEVICE_PRESETS = [
  {id:"iphone-se",name:"iPhone SE",group:"Apple",width:375,height:667,dpr:2},
  {id:"iphone-13-mini",name:"iPhone 13 mini",group:"Apple",width:375,height:812,dpr:3},
  {id:"iphone-15",name:"iPhone 15",group:"Apple",width:393,height:852,dpr:3},
  {id:"iphone-15-pro-max",name:"iPhone 15 Pro Max",group:"Apple",width:430,height:932,dpr:3},
  {id:"iphone-16-pro",name:"iPhone 16 Pro",group:"Apple",width:402,height:874,dpr:3},
  {id:"galaxy-s23",name:"Galaxy S23",group:"Samsung",width:360,height:780,dpr:3},
  {id:"galaxy-s24-ultra",name:"Galaxy S24 Ultra",group:"Samsung",width:412,height:915,dpr:3},
  {id:"pixel-7",name:"Google Pixel 7",group:"Google",width:412,height:915,dpr:2.625},
  {id:"pixel-9-pro",name:"Google Pixel 9 Pro",group:"Google",width:412,height:915,dpr:2.625},
  {id:"galaxy-fold",name:"Galaxy Z Fold (outer)",group:"Samsung",width:280,height:653,dpr:3},
  {id:"ipad-mini",name:"iPad mini",group:"Tablet",width:768,height:1024,dpr:2},
  {id:"ipad-pro",name:"iPad Pro 12.9",group:"Tablet",width:1024,height:1366,dpr:2},
  {id:"desktop",name:"Desktop",group:"Desktop",width:1440,height:900,dpr:1}
];
const DEFAULT_DEVICE_IDS = ["iphone-15","galaxy-s23","pixel-7"];
function normalizeWebsiteUrl(raw) {
  let value = String(raw || "").trim();
  if (!value) throw new Error("آدرس وب‌سایت را وارد کنید.");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) value = "https://" + value;
  let url;
  try { url = new URL(value); } catch (_) { throw new Error("آدرس واردشده معتبر نیست."); }
  if (!["https:","http:"].includes(url.protocol)) {
    throw new Error("فقط آدرس‌های HTTP و HTTPS پشتیبانی می‌شوند.");
  }
  if (!url.hostname) throw new Error("نام دامنه وارد نشده است.");
  return url.href;
}
function getDevice(id) {
  return DEVICE_PRESETS.find((item) => item.id === id);
}
