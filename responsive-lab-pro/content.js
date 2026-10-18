/* Inert until activated. Never sends page content to an external server. */
if (!globalThis.__RESPONSIVE_LAB_CONTENT_V1__) {
  globalThis.__RESPONSIVE_LAB_CONTENT_V1__=true;
  (()=>{
    let selected=null, selector='', picking=false, outline=null, hint=null;
    let currentEdits=new Map(),originalValues=new Map(),history=[];
    const RULES_KEY='responsiveLabRulesV1';
    const styleProps=['display','position','width','min-width','max-width','height','min-height','max-height','flex-direction','flex-wrap','justify-content','align-items','grid-template-columns','gap','padding','margin','font-size','line-height','overflow-x','overflow-y','box-sizing','color','background-color'];
    const cleanProperty=(name)=>/^([a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)$/i.test(name);
    function elementSelector(el){
      if (!(el instanceof Element)) return '';
      const parts=[];
      for(let node=el;node&&node.nodeType===1&&parts.length<8;node=node.parentElement){
        const tag=node.localName;
        if (node.id) {parts.unshift('#'+CSS.escape(node.id));break;}
        let part=tag;
        const testId=node.getAttribute('data-testid');
        if(testId){part+=`[data-testid="${CSS.escape(testId)}"]`;parts.unshift(part);break;}
        const siblings=node.parentElement ? [...node.parentElement.children].filter(n=>n.localName===tag):[];
        if(siblings.length>1) part+=`:nth-of-type(${siblings.indexOf(node)+1})`;
        parts.unshift(part);
        if(tag==='body')break;
      }
      return parts.join(' > ');
    }
    function ensureOutline(){
      if(outline)return;
      outline=document.createElement('div');
      Object.assign(outline.style,{position:'fixed',zIndex:'2147483647',pointerEvents:'none',border:'2px solid #3b82f6',background:'rgba(59,130,246,.12)',borderRadius:'3px',boxSizing:'border-box',display:'none'});
      hint=document.createElement('div');
      Object.assign(hint.style,{position:'fixed',zIndex:'2147483647',pointerEvents:'none',background:'#111c37',color:'#fff',font:'12px sans-serif',padding:'6px 9px',borderRadius:'5px',display:'none',maxWidth:'75vw',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',direction:'ltr'});
      (document.documentElement||document.body).append(outline,hint);
    }
    function highlight(el){
      ensureOutline();
      if(!el || !el.isConnected){outline.style.display='none';hint.style.display='none';return;}
      const r=el.getBoundingClientRect();
      Object.assign(outline.style,{display:'block',left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
      Object.assign(hint.style,{display:'block',left:`${Math.max(3,r.left)}px`,top:`${Math.max(3,r.top-30)}px`});
      hint.textContent=`${el.localName} • ${Math.round(r.width)} × ${Math.round(r.height)}`;
    }
    function details(){
      if(!selected||!selected.isConnected)return null;
      const r=selected.getBoundingClientRect(),s=getComputedStyle(selected),values={};
      for(const prop of styleProps)values[prop]=s.getPropertyValue(prop).trim();
      return {selector,tag:selected.localName,id:selected.id||'',classes:[...selected.classList].slice(0,8),
        size:{width:Math.round(r.width),height:Math.round(r.height),x:Math.round(r.left),y:Math.round(r.top)},values,
        edits:Object.fromEntries(currentEdits)};
    }
    function move(e){ if(!picking)return;const el=e.target;if(el!==outline&&el!==hint)highlight(el); }
    function select(e){
      if(!picking)return;
      e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();
      selected=e.target;
      selector=elementSelector(selected);
      currentEdits=new Map(); originalValues=new Map(); history=[];
      stop();highlight(selected);
      chrome.runtime.sendMessage({type:'ELEMENT_PICKED',details:details()}).catch(()=>{});
    }
    function start(){
      stop();picking=true;ensureOutline();
      document.addEventListener('pointermove',move,true);
      document.addEventListener('click',select,true);
      document.documentElement.style.cursor='crosshair';
    }
    function stop(){
      picking=false;
      document.removeEventListener('pointermove',move,true);
      document.removeEventListener('click',select,true);
      document.documentElement.style.removeProperty('cursor');
      if(outline)outline.style.display='none';
      if(hint)hint.style.display='none';
    }
    function setOne(prop,value){
      if(!selected||!selected.isConnected)throw Error('ابتدا با ابزار انتخاب، المان را مشخص کنید.');
      if(!cleanProperty(prop))throw Error('نام ویژگی CSS معتبر نیست.');
      const next=String(value).trim().slice(0,500);
      if(!originalValues.has(prop)) originalValues.set(prop,{value:selected.style.getPropertyValue(prop),priority:selected.style.getPropertyPriority(prop)});
      history.push({prop,value:selected.style.getPropertyValue(prop),priority:selected.style.getPropertyPriority(prop),editValue:currentEdits.has(prop)?currentEdits.get(prop):null});
      if(next===''){const o=originalValues.get(prop);selected.style.setProperty(prop,o.value,o.priority);currentEdits.delete(prop);}
      else {selected.style.setProperty(prop,next,'important');currentEdits.set(prop,next);}
      highlight(selected);
      return details();
    }
    function undo(){
      if(!selected||!history.length)return details();
      const last=history.pop();
      selected.style.setProperty(last.prop,last.value,last.priority);
      if(last.editValue===null)currentEdits.delete(last.prop);
      else currentEdits.set(last.prop,last.editValue);
      highlight(selected);return details();
    }
    function resetStyles(){
      if(selected&&selected.isConnected){for(const [prop,old] of originalValues)selected.style.setProperty(prop,old.value,old.priority);}
      currentEdits.clear();originalValues.clear();history=[];highlight(selected);return details();
    }
    function save(){
      if(!selected||!selector||!currentEdits.size)throw Error('هیچ تغییر جدیدی برای ذخیره وجود ندارد.');
      return {selector,styles:Object.fromEntries(currentEdits),url:location.origin};
    }
    const visible=el=>{
      const r=el.getBoundingClientRect();if(!r.width||!r.height)return false;
      const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden';
    };
    function audit(){
      const width=Math.round(document.documentElement.clientWidth);
      const scrollWidth=Math.round(document.documentElement.scrollWidth);
      const overflow=[];const smallTargets=[];const clipped=[];
      const els=[...document.body.querySelectorAll('*')].slice(0,5500);
      for(const el of els){
        if(el===outline||el===hint||!visible(el))continue;
        const r=el.getBoundingClientRect();
        if(overflow.length<25 && (r.right>width+2 || r.left < -2) && r.width>0 && getComputedStyle(el).position!=='fixed'){
          overflow.push({selector:elementSelector(el),right:Math.round(r.right),left:Math.round(r.left),width:Math.round(r.width)});
        }
        if(smallTargets.length<25 && el.matches('a,button,input,select,textarea,[role="button"]') && r.width>0 && r.height>0 && r.top>=0 && r.top<innerHeight*2 && (r.width<30||r.height<30)){
          smallTargets.push({selector:elementSelector(el),width:Math.round(r.width),height:Math.round(r.height)});
        }
        if(clipped.length<15 && el.children.length===0 && (getComputedStyle(el).overflowX==='hidden'||getComputedStyle(el).textOverflow==='ellipsis') && el.scrollWidth>el.clientWidth+2){
          clipped.push({selector:elementSelector(el),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth});
        }
      }
      return {title:document.title,url:location.href,viewport:{width,height:innerHeight,dpr:devicePixelRatio},
        horizontalOverflow:scrollWidth>width+2,documentWidth:scrollWidth,
        missingViewportMeta:!document.querySelector('meta[name="viewport"]'),overflow,smallTargets,clipped,
        checkedElements:els.length,timestamp:new Date().toISOString()};
    }
    function restoreRules(){
      chrome.storage.local.get(RULES_KEY).then(store=>{
        const bySite=store[RULES_KEY]||{};const rules=bySite[location.origin]||[];
        if(!Array.isArray(rules)||!rules.length)return;
        const style=document.createElement('style');style.id='responsive-lab-persistent-css';
        style.textContent=rules.map(rule=>`${rule.selector} { ${Object.entries(rule.styles||{}).filter(([p])=>cleanProperty(p)).map(([p,v])=>`${p}: ${String(v).replace(/[{};]/g,'')} !important;`).join(' ')} }`).join('\n');
        (document.head||document.documentElement).append(style);
      }).catch(()=>{});
    }
    chrome.runtime.onMessage.addListener((request,sender,respond)=>{
      try{
        let data;
        switch(request.type){
          case 'START_PICK': start();data={picking:true};break;
          case 'STOP_PICK': stop();data={picking:false};break;
          case 'SET_STYLE': data=setOne(request.property,request.value);break;
          case 'SET_STYLES':
            for(const [key,value] of Object.entries(request.styles||{}))setOne(key,value);
            data=details();break;
          case 'UNDO': data=undo();break;
          case 'RESET_STYLES':data=resetStyles();break;
          case 'GET_SELECTED':data=details();break;
          case 'SAVE_STYLE':data=save();break;
          case 'AUDIT':data=audit();break;
          default:return false;
        }
        respond(data);
      }catch(e){respond({error:e.message});}
      return false;
    });
    restoreRules();
  })();
}
