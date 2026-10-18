/* CSS viewport dimensions (not physical display pixels). */
const DEVICE_PRESETS = Object.freeze([
  {group:'گوشی‌های اپل',id:'iphone-se',name:'iPhone SE (2022)',width:375,height:667,dpr:2,platform:'ios'},
  {group:'گوشی‌های اپل',id:'iphone-13-mini',name:'iPhone 13 mini',width:375,height:812,dpr:3,platform:'ios'},
  {group:'گوشی‌های اپل',id:'iphone-14',name:'iPhone 14',width:390,height:844,dpr:3,platform:'ios'},
  {group:'گوشی‌های اپل',id:'iphone-15-pro',name:'iPhone 15 Pro',width:393,height:852,dpr:3,platform:'ios'},
  {group:'گوشی‌های اپل',id:'iphone-16-pro-max',name:'iPhone 16 Pro Max',width:440,height:956,dpr:3,platform:'ios'},
  {group:'گوشی‌های اندرویدی',id:'pixel-7',name:'Google Pixel 7',width:412,height:915,dpr:2.625,platform:'android'},
  {group:'گوشی‌های اندرویدی',id:'pixel-8-pro',name:'Google Pixel 8 Pro',width:448,height:998,dpr:3,platform:'android'},
  {group:'گوشی‌های اندرویدی',id:'galaxy-s23',name:'Samsung Galaxy S23',width:360,height:780,dpr:3,platform:'android'},
  {group:'گوشی‌های اندرویدی',id:'galaxy-s24-ultra',name:'Samsung Galaxy S24 Ultra',width:412,height:915,dpr:3,platform:'android'},
  {group:'گوشی‌های تاشو',id:'galaxy-fold-cover',name:'Galaxy Z Fold (بیرونی)',width:344,height:882,dpr:3,platform:'android'},
  {group:'گوشی‌های تاشو',id:'galaxy-fold-open',name:'Galaxy Z Fold (باز)',width:884,height:1104,dpr:2.5,platform:'android'},
  {group:'تبلت‌ها',id:'ipad-mini',name:'iPad mini',width:768,height:1024,dpr:2,platform:'ios'},
  {group:'تبلت‌ها',id:'ipad-pro',name:'iPad Pro 12.9',width:1024,height:1366,dpr:2,platform:'ios'},
  {group:'تبلت‌ها',id:'surface-duo',name:'Surface Duo',width:540,height:720,dpr:2.5,platform:'android'},
  {group:'دسکتاپ',id:'laptop',name:'Laptop 1366',width:1366,height:768,dpr:1,platform:'desktop'},
  {group:'دسکتاپ',id:'desktop',name:'Desktop 1440',width:1440,height:900,dpr:1,platform:'desktop'},
  {group:'دسکتاپ',id:'wide',name:'Full HD',width:1920,height:1080,dpr:1,platform:'desktop'}
]);
const QUICK_WIDTHS = [320,360,375,390,414,768,1024,1280];
