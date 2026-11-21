/* Coolage frontend — vanilla JS, no build step. All demo data is fictional. */
(() => {
'use strict';
const root=document.getElementById('root'),toastEl=document.getElementById('toast'),noticeEl=document.getElementById('notice-layer');
const configValue=String(window.COOLAGE_CONFIG?.apiBaseUrl??'').trim();
let API_ORIGIN='', CONFIG_ERROR='';
if(configValue){
 try {
  const parsed=new URL(configValue);
  if((parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&['localhost','127.0.0.1'].includes(parsed.hostname)))||
      parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)
   throw Error('Use an HTTPS Worker origin without a path (e.g. https://coolage.example.workers.dev).');
  API_ORIGIN=parsed.origin;
 }catch(e){CONFIG_ERROR='Invalid API URL in config.js. '+(e.message||'');}
}
const IS_REMOTE_API=!!API_ORIGIN&&API_ORIGIN!==location.origin;
const SESSION_KEY='coolage_session_v4:'+API_ORIGIN;
function readToken(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch{return ''}}
function saveToken(value){try{if(value)sessionStorage.setItem(SESSION_KEY,value);else sessionStorage.removeItem(SESSION_KEY);return true}catch{return false}}
let sessionToken=IS_REMOTE_API?readToken():'';

const icons={
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  person:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>',
  school:'<path d="m2 10 10-7 10 7M4 10v10h16V10M9 20v-6h6v6M8 9h.01M16 9h.01"/>',
  shield:'<path d="m12 2 9 4v6c0 5-3.5 8.2-9 10-5.5-1.8-9-5-9-10V6z"/><path d="m8 12 3 3 5-6"/>',
  spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',
  edit:'<path d="m15 5 4 4M4 20l4.5-1 11-11a2.83 2.83 0 0 0-4-4l-11 11z"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  award:'<circle cx="12" cy="8" r="6"/><path d="m8 13-2 9 6-3 6 3-2-9"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 10-10m-5 5 4 4m-2-2 2 2"/>',
};
const icon=(key,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]||icons.grid}</svg>`;
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=(ms)=>{try{return new Date(ms).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'})}catch{return String(ms)}};
const today=()=>new Date().toLocaleDateString('en-CA');
const state={page:'login',role:'student',error:'',success:'',modal:null,section:'overview',user:null,demo:false,demoRole:'staff',
  students:[],staff:[],homework:[],announcements:[],attendance:[],attSummary:null,calendarMonth:today().slice(0,7),classes:[],working:false,
  requestDraft:{name:'',city:'',ownerName:'',ownerEmail:''},requestFailed:false,requestKey:null,
  apiStatus:'checking',apiMessage:'Checking Cloudflare API…'};
function sampleAttendance(studentId){
 const entries=[];const d=new Date();d.setHours(12,0,0,0);
 for(let i=0;entries.length<25&&i<50;i++){
   const date=new Date(d);date.setDate(d.getDate()-i);
   if(date.getDay()===0||date.getDay()===6)continue;
   const day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
   entries.push({studentId,date:day,status:entries.length%9===4?'absent':'present'});
 }
 return entries;
}
const demoSeed={students:[
 {id:'demo-s-1',loginId:'STU1001',name:'Alex Morgan',className:'10',section:'A'},
 {id:'demo-s-2',loginId:'STU1002',name:'Priya Kapoor',className:'10',section:'A'},
 {id:'demo-s-3',loginId:'STU1003',name:'Kabir Mehta',className:'12',section:'A'}],
 staff:[{id:'demo-t-1',loginId:'TCH1001',name:'Noor Sharma',classes:[{className:'10',section:'A'},{className:'12',section:'A'}]}],
 homework:[{id:'demo-h-1',title:'Algebra practice',details:'Solve questions 1–10 from the worksheet.',dueDate:'2026-11-18',className:'10',section:'A',author:'Noor Sharma',subject:'Mathematics',createdAt:Date.now()-3000000},
 {id:'demo-h-2',title:'Physics project outline',details:'Prepare a one-page project proposal.',dueDate:'2026-11-20',className:'12',section:'A',author:'Noor Sharma',subject:'Physics',createdAt:Date.now()-15000000}],
 announcements:[{id:'demo-a-1',title:'Annual science showcase',body:'The science showcase will be held next Friday in the auditorium. Everyone is welcome to attend!',className:'',section:'',author:'School Office',createdAt:Date.now()-3600000},
 {id:'demo-a-2',title:'Class 10 notebook check',body:'Please bring your completed mathematics notebooks to class.',className:'10',section:'A',author:'Noor Sharma',createdAt:Date.now()-12000000}],
 attendance:[...sampleAttendance('demo-s-1'),{studentId:'demo-s-2',date:today(),status:'absent'},{studentId:'demo-s-3',date:today(),status:'present'}]
};
let demoData=null,toastTimer=null;
const owner={id:'demo-admin',name:'Avery Bennett',role:'admin',loginId:'ADM1001',schoolCode:'NORTH001',schoolName:'Northfield Academy',className:'',section:'',needsPasswordChange:false};
const teacher={id:'demo-t-1',name:'Noor Sharma',role:'staff',loginId:'TCH1001',schoolCode:'NORTH001',schoolName:'Northfield Academy',className:'',section:'',needsPasswordChange:false};
const pupil={id:'demo-s-1',name:'Alex Morgan',role:'student',loginId:'STU1001',schoolCode:'NORTH001',schoolName:'Northfield Academy',className:'10',section:'A',needsPasswordChange:false};
function showNotice(kind,title,message,details=[],continueLabel='Continue'){
 noticeEl.innerHTML=`<div class="notice-screen" role="presentation"><section class="notice-dialog" role="alertdialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-description"><div class="notice-symbol ${esc(kind)}">${icon(kind==='error'?'close':'check',24)}</div><h2 id="notice-title">${esc(title)}</h2><p id="notice-description">${esc(message)}</p>${details.map(([label,value])=>`<div class="notice-detail"><div><small>${esc(label)}</small><strong>${esc(value)}</strong></div><button type="button" class="notice-copy" data-copy="${esc(value)}" aria-label="Copy ${esc(label)}">Copy</button></div>`).join('')}<button type="button" class="btn btn-primary btn-full" data-notice-close>${esc(continueLabel)}</button></section></div>`;
 document.body.style.overflow='hidden';noticeEl.querySelector('[data-notice-close]')?.focus();
}
function closeNotice(){noticeEl.innerHTML='';document.body.style.overflow=''}
function notify(message,kind='success'){showNotice(kind,kind==='error'?'Something went wrong':'Success',message)}
noticeEl.addEventListener('click',async e=>{const copy=e.target.closest('[data-copy]');if(copy){try{await navigator.clipboard.writeText(copy.dataset.copy);copy.textContent='Copied!'}catch{copy.textContent='Copy unavailable'}return}if(e.target.closest('[data-notice-close]'))closeNotice()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&noticeEl.children.length)closeNotice()});

async function api(path,method='GET',payload){
 if(CONFIG_ERROR)throw Error(CONFIG_ERROR);
 if(location.protocol==='file:')throw Error('Open Coolage on your HTTPS hosting URL to use live APIs. Local files only support the fictional-data demo.');
 const opts={method,credentials:IS_REMOTE_API?'omit':'same-origin',headers:{}};
 if(IS_REMOTE_API&&sessionToken)opts.headers['Authorization']='Bearer '+sessionToken;
 if(payload!==undefined){opts.headers['content-type']='application/json';opts.body=JSON.stringify(payload)}
 else if(method!=='GET'){opts.headers['content-type']='application/json';opts.body='{}'}
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),12000);
 try {
  const endpoint=(API_ORIGIN||'')+'/api/'+path;
  const res=await fetch(endpoint,{...opts,signal:controller.signal});
  const mime=(res.headers.get('content-type')||'').toLowerCase();
  if(!mime.includes('application/json'))throw Error(IS_REMOTE_API?
   'The configured Cloudflare Worker returned a non-JSON response. Check the Worker URL and API deployment.':
   'No Coolage API was found on this host. For InfinityFree, set apiBaseUrl in config.js to your deployed Cloudflare Worker URL.');
  let data;try{data=await res.json()}catch{throw Error('The server returned an unreadable response. Please retry.')}
  if(!res.ok)throw Error(data.error||`The server returned error ${res.status}. Please retry.`);
  return data;
 }catch(err){
  if(err?.name==='AbortError')throw Error('Request timed out. Check the Cloudflare API connection and retry.');
  if(err instanceof TypeError)throw Error(IS_REMOTE_API?
   'Unable to connect to Cloudflare API. Check config.js, FRONTEND_ORIGIN on the Worker, HTTPS, and your network.':
   'Cannot reach the Coolage API. Deploy the full Cloudflare Worker or configure its URL in config.js.');
  throw err;
 }finally{clearTimeout(timer)}
}
async function checkBackend(){
 if(CONFIG_ERROR){state.apiStatus='offline';state.apiMessage=CONFIG_ERROR;render();return}
 if(location.protocol==='file:'){
  state.apiStatus='offline';state.apiMessage='Offline demo: live APIs require an HTTPS website.';render();return;
 }
 state.apiStatus='checking';state.apiMessage='Checking Cloudflare API…';render();
 try {
  const result=await api('health');
  if(!result.ok||!result.databaseConfigured)throw Error('Cloudflare API is reachable, but the D1 database is not configured.');
  state.apiStatus='online';state.apiMessage='Cloudflare API connected';
 }catch(e){state.apiStatus='offline';state.apiMessage=e.message||'API connection failed.'}
 render();
}

function startDemo(role='staff'){
 if(!demoData)demoData=structuredClone(demoSeed);
 state.demo=true;state.demoRole=role;state.user=role==='admin'?owner:role==='student'?pupil:teacher;
 state.section='overview';state.page='app';state.modal=null;state.error='';state.calendarMonth=today().slice(0,7);syncDemo();render();
}
function syncDemo(){
 state.students=demoData.students.filter(s=>state.user.role!=='student'&&(state.user.role==='admin'||isTeacherClass(s.className,s.section)));
 state.staff=demoData.staff;state.classes=state.user.role==='student'?[{className:state.user.className,section:state.user.section}]
 :state.user.role==='admin'?[{className:'10',section:'A'},{className:'12',section:'A'}]:[...demoData.staff[0].classes];
 state.homework=demoData.homework.filter(h=>state.user.role==='admin'||state.user.role==='staff'&&isTeacherClass(h.className,h.section)
 ||state.user.role==='student'&&h.className===state.user.className&&h.section===state.user.section);
 state.announcements=demoData.announcements.filter(a=>state.user.role==='admin'||a.className===''||
 state.user.role==='student'&&a.className===state.user.className&&a.section===state.user.section ||
 state.user.role==='staff'&&isTeacherClass(a.className,a.section));
 state.attendance=state.user.role==='student'?demoData.attendance.filter(a=>a.studentId===state.user.id):demoData.attendance;
 state.attSummary=null;
}
function isTeacherClass(className,section){return demoData?.staff.find(s=>s.id===teacher.id)?.classes.some(c=>c.className===className&&c.section===section)||false}
async function loadData(){
 if(state.demo){syncDemo();render();return}
 const role=state.user.role;
 try{
  const paths=['classes','homework','announcements',...(role!=='student'?['students']:[]),...(role==='admin'?['staff']:[]),'attendance'+(role==='student'?'':'?date='+(state.attDate||today()))];
  const responses=await Promise.all(paths.map(path=>api(path).catch(err=>({error:err.message}))));
  for(const r of responses){if(r.error){notify(r.error,'error');continue}
    for(const key of ['classes','students','staff','homework','announcements','attendance'])if(Array.isArray(r[key]))state[key]=r[key];
    if(r.summary)state.attSummary=r.summary;}
  render();
 }catch(e){notify(e.message,'error')}
}
function loginMarkup(){
 const request=state.page==='request';
 return `<div class="auth-shell"><section class="auth-side">
    <div class="logo"><span class="logo-symbol">C</span><span class="logo-word">cool<span>age</span></span></div>
    <div class="tagline"><div class="eyebrow">A better way to run school life</div>
     <h1>Every school.<br>One <em>Coolage.</em><br>All connected.</h1>
     <p>One connected workspace for schools and colleges, students and staff.</p>
     <div class="orbit"><div class="orbit-line"></div><div class="floating one"><span class="orb">${icon('users')}</span><span><b>People, together</b><small>Students · Teachers · Admin</small></span></div>
      <div class="floating two"><span class="orb">${icon('book')}</span><span><b>Learning, organized</b><small>Homework and updates</small></span></div>
      <div class="floating three"><span class="orb">${icon('shield')}</span><span><b>Your school, private</b><small>Separate data for every school</small></span></div></div>
    </div><div class="auth-footer"><span>© ${new Date().getFullYear()} Coolage</span><span>Designed for connected schools</span></div>
   </section><section class="auth-main"><div class="auth-top-note">Simple. Connected. Secure by design.</div><div class="auth-panel">
   <div class="accent-line"></div><div class="eyebrow">${request?'Bring your school aboard':'Your school starts here'}</div>
   <h2>${request?'Create your school':'Welcome back.'}</h2>
   <p class="subline">${request?'Create your school and choose an admin password. Your school is activated immediately.':'Choose your role and use the credentials provided by your school.'}</p>
   ${state.error?`<div role="alert" class="feedback"><p>${esc(state.error)}</p>${request&&state.requestFailed?`<div class="request-recovery"><span>Your school details are saved. Re-enter your password and submit again.</span></div>`:''}</div>`:''}
   ${state.success?`<div role="status" class="feedback success">${esc(state.success)}</div>`:''}
   <div class="api-status ${esc(state.apiStatus)}" role="status"><span class="api-indicator" aria-hidden="true"></span>
     <span>${esc(state.apiMessage)}</span>
     <button type="button" data-action="check-api" class="api-recheck" aria-label="Retry API connection check">Check API</button></div>
   ${request?`<form id="request-form">
       ${location.protocol==='file:'?'<div class="alert-note">Offline preview: you can explore Coolage, but school requests need a deployed Cloudflare Worker and D1 database.</div>':''}
       ${field('School name','name','e.g. Northfield Academy',true,'text',state.requestDraft.name)}
       ${field('City / location','city','e.g. New Delhi',false,'text',state.requestDraft.city)}
       ${field('Your full name','ownerName','School representative',true,'text',state.requestDraft.ownerName)}
       ${field('Contact email','ownerEmail','you@school.edu',true,'email',state.requestDraft.ownerEmail)}
       ${field('Admin password (6+ characters)','password','Choose a strong password',true,'password')}
       ${field('Confirm admin password','confirmPassword','Repeat your password',true,'password')}
       <button class="btn btn-primary btn-full" type="submit">Create school ${icon('arrow',18)}</button>
       <p class="helper">Requires Cloudflare API. Use fictional details during testing. Registration is automatic; email ownership is not yet verified.</p>
     </form><hr class="auth-separator"><div class="school-link">Already have credentials? <button type="button" class="link-button" data-action="login">Sign in</button></div>`:
     `<div class="role-switch"><button type="button" class="role-choice ${state.role==='student'?'selected':''}" data-action="role" data-role="student">${icon('person')} Student</button>
       <button type="button" class="role-choice ${state.role==='staff'?'selected':''}" data-action="role" data-role="staff">${icon('users')} Staff / Admin</button></div>
      <form id="login-form">${field('School code','schoolCode','e.g. NORTH001',true)}
      ${field(state.role==='student'?'Student ID':'Staff / Admin ID','loginId',state.role==='student'?'e.g. STU1001':'e.g. TCH1001',true)}
      ${field('Password','password','Your school-issued password',true,'password')}
      <button class="btn btn-primary btn-full" type="submit">Sign in to your school ${icon('arrow',18)}</button></form>
      <hr class="auth-separator"><div class="school-link">School owner? <button class="link-button" type="button" data-action="request">Add your school ${icon('arrow',14)}</button></div>
      <div class="alert-note" style="margin-top:26px">Want to explore first? <b>Preview a fictional school</b> without connecting a database or entering real student information.
      <button style="margin-top:12px" type="button" class="btn btn-secondary btn-full" data-action="demo">${icon('spark')} Explore demo dashboard</button></div>`}
   <p class="mini-note">Accounts are issued by authorized school staff. Never use real student details in demo mode.</p>
   </div></section></div>`;
}
function field(label,name,placeholder,required=true,type='text',value=''){
 return `<div class="field"><label for="${esc(name)}">${esc(label)}</label><input class="control" id="${esc(name)}" name="${esc(name)}" type="${type}" placeholder="${esc(placeholder)}" value="${esc(value)}" ${required?'required':''} ${name==='password'?'autocomplete="current-password"':''} maxlength="180"></div>`;
}
function textArea(label,name,placeholder,required=true){return `<div class="field"><label for="${esc(name)}">${esc(label)}</label><textarea class="control" id="${esc(name)}" name="${esc(name)}" placeholder="${esc(placeholder)}" ${required?'required':''} maxlength="1500"></textarea></div>`}
function logo(){return `<div class="logo"><span class="logo-symbol">C</span><span class="logo-word">cool<span>age</span></span></div>`}
const nav={overview:['home','Overview'],students:['users','Students'],staff:['person','Staff'],homework:['book','Homework'],attendance:['calendar','Attendance'],announcements:['bell','Announcements'],settings:['settings','Settings']};
function tabs(){return ['overview',...(state.user.role!=='student'?['students']:[]),...(state.user.role==='admin'?['staff']:[]),'homework','attendance','announcements','settings']}
function appMarkup(){
 const u=state.user,list=tabs();
 return `${state.demo?`<div class="demo-ribbon"><strong>Demo mode</strong> · All names and records are fictional; changes are not saved to a real school database.</div>`:''}
  <div class="app-shell"><aside class="sidebar"><div class="desktop-brand">${logo()}</div><div class="mobile-head">${logo()}<button type="button" class="logout" data-action="logout" aria-label="Sign out">${icon('logout')}</button></div>
  <div class="school-chip"><span class="school-icon">${icon('school')}</span><div><strong>${esc(u.schoolName)}</strong><small>${esc(u.schoolCode)}</small></div></div>
  <div class="nav-label">Workspace</div><nav aria-label="Main navigation">${list.map(key=>`<button class="nav-button ${state.section===key?'active':''}" type="button" data-action="navigate" data-section="${key}">${icon(nav[key][0])}<span>${nav[key][1]}</span></button>`).join('')}</nav>
  <div class="sidebar-spacer"></div><div class="account-mini"><div class="avatar">${esc(u.name.slice(0,1))}</div><div><strong>${esc(u.name)}</strong><small>${u.role==='admin'?'School administrator':u.role==='staff'?'Teaching staff':'Student'}</small></div><button class="logout" title="Sign out" data-action="logout">${icon('logout',17)}</button></div>
  </aside><main class="main"><header class="topbar"><div class="breadcrumbs">${esc(u.schoolName)} &nbsp; / &nbsp; <b>${nav[state.section]?.[1]||'Overview'}</b></div>
   <div class="topbar-right">${state.demo?`<span class="pill demo">Demo environment</span>`:`<span class="pill">Verified login</span>`}<span class="topbar-date">${new Date().toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'})}</span></div></header>
   ${state.demo?`<div class="demo-chooser" aria-label="Demo roles">${['student','staff','admin'].map(role=>`<button type="button" class="${u.role===role?'active':''}" data-action="switch-demo" data-role="${role}">${icon(role==='student'?'person':role==='staff'?'users':'shield',16)} ${role==='staff'?'Teacher':role==='admin'?'School admin':'Student'}</button>`).join('')}</div>`:''}
   ${sectionMarkup()}<p class="footer-line">Coolage · ${state.demo?'Fictional demonstration only':'Private school workspace'} · Role-based access</p>
   </main></div>${state.modal?modalMarkup():''}`;
}
function pageHead(title,subtitle,btnText='',action=''){
 return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${btnText?`<button class="btn btn-primary" data-action="${action}">${icon('plus')} ${esc(btnText)}</button>`:''}</div>`;
}
function metric(name,num,ic='book',tint='',sub='At your school'){
 return `<div class="metric"><div class="metric-head"><span>${esc(name)}</span><span class="metric-icon ${tint}">${icon(ic)}</span></div><strong>${esc(num)}</strong><small>${esc(sub)}</small></div>`;
}
function sectionMarkup(){switch(state.section){case 'students':return studentsMarkup();case 'staff':return staffMarkup();case 'homework':return homeworkMarkup();case 'attendance':return attendanceMarkup();case 'announcements':return announcementsMarkup();case 'settings':return settingsMarkup();default:return overviewMarkup()}}
function attendanceStats(){
 const present=state.attSummary?Number(state.attSummary.present)||0:state.attendance.filter(a=>a.status==='present').length;
 const absent=state.attSummary?Number(state.attSummary.absent)||0:state.attendance.filter(a=>a.status==='absent').length;
 const total=present+absent;
 return {present,absent,total,percentage:total?Math.round(present*100/total):null};
}
function shiftMonth(month,delta){
 const [year,part]=month.split('-').map(Number);
 const date=new Date(year,part-1+delta,1);
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function attendanceCalendarMarkup(){
 const [year,part]=state.calendarMonth.split('-').map(Number);
 const display=new Date(year,part-1,1).toLocaleDateString(undefined,{month:'long',year:'numeric'});
 const first=(new Date(year,part-1,1).getDay()+6)%7;
 const last=new Date(year,part,0).getDate();
 const byDate=new Map(state.attendance.filter(a=>a.date?.startsWith(state.calendarMonth)).map(a=>[a.date,a.status]));
 const cells=Array.from({length:first},()=>'<span class="calendar-blank" aria-hidden="true"></span>');
 for(let day=1;day<=last;day++){
   const iso=`${state.calendarMonth}-${String(day).padStart(2,'0')}`;
   const status=byDate.get(iso)||'';
   const isToday=iso===today();
   cells.push(`<div class="calendar-day ${status||'unmarked'} ${isToday?'today':''}" aria-label="${esc(iso)}: ${status||'not marked'}" title="${esc(iso)}: ${status||'Not marked'}"><span>${day}</span>${status?`<small>${status==='present'?'P':'A'}</small>`:''}</div>`);
 }
 return `<section class="panel attendance-calendar" aria-label="Student attendance calendar">
  <div class="calendar-header"><div><div class="eyebrow">Your attendance</div><h3>Attendance calendar</h3><p>See recorded present and absent days at a glance.</p></div>
   <div class="month-controls"><button type="button" data-action="calendar-prev" aria-label="Previous month">&#8249;</button><strong aria-live="polite">${esc(display)}</strong><button type="button" data-action="calendar-next" aria-label="Next month">&#8250;</button></div></div>
  <div class="calendar-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<span>${d}</span>`).join('')}</div>
  <div class="calendar-days">${cells.join('')}</div>
  <div class="calendar-legend"><span><i class="legend-dot present"></i> Present</span><span><i class="legend-dot absent"></i> Absent</span><span><i class="legend-dot unmarked"></i> Not recorded</span></div>
  <p class="calendar-note">Unmarked days are not counted as absences. Your overall rate uses all recorded attendance days.</p>
 </section>`;
}
function overviewMarkup(){
 const u=state.user,isStudent=u.role==='student';
 const stats=attendanceStats();
 const visibleAttendance=state.attendance.filter(a=>a.status==='present').length;
 return `${pageHead(`Good to see you, ${u.name.split(' ')[0]}.`,isStudent?'Your school day, simplified.': 'Here’s what’s happening across your workspace today.')}
  <div class="hero"><div><div class="eyebrow" style="margin-bottom:9px">Your digital school space</div><h2>${isStudent?'Make today a great learning day.':u.role==='admin'?'Everything your school needs, together.':'Your classroom, all in one place.'}</h2>
  <p>${isStudent?'Check your homework, attendance, and the latest announcements.': 'Keep classes informed, stay on top of assignments, and support every student.'}</p></div>${icon(isStudent?'award':'school',75)}</div>
  <div class="metric-grid">
   ${isStudent?metric('Overall attendance',stats.percentage===null?'—':`${stats.percentage}%`,'calendar','mint',`${stats.total} recorded days`):metric('Students',state.students.length,'users','','In your school/classes')}
   ${isStudent?metric('Days present',stats.present,'check','','From recorded attendance'):metric('Assignments',state.homework.length,'book','purple','Active records')}
   ${isStudent?metric('Homework',state.homework.length,'book','purple','Assigned to your class'):metric('Marked present',visibleAttendance,'calendar','','Attendance records shown')}
   ${metric('Announcements',state.announcements.length,'bell','gold','Latest school updates')}
  </div>
  ${isStudent?attendanceCalendarMarkup():''}
  <div class="content-grid"><section class="panel panel-pad"><div class="panel-title"><h3>Latest homework</h3><button class="text-link" data-action="navigate" data-section="homework">View all ${icon('arrow',14)}</button></div>
  ${state.homework.length?state.homework.slice(0,4).map(h=>`<div class="list-item"><span class="list-icon">${icon('book')}</span><div><strong>${esc(h.title)}</strong><small>${esc(h.author)} · ${esc(h.subject||'General')} · Due ${esc(h.dueDate)}</small></div></div>`).join(''):empty('No homework assigned yet.','book')}</section>
  <section class="panel panel-pad"><div class="panel-title"><h3>School updates</h3><button class="text-link" data-action="navigate" data-section="announcements">See all ${icon('arrow',14)}</button></div>
  ${state.announcements.length?state.announcements.slice(0,4).map(a=>`<div class="list-item"><span class="list-icon green">${icon('bell')}</span><div><strong>${esc(a.title)}</strong><small>${esc(a.author)} · ${format(a.createdAt)}</small></div></div>`).join(''):empty('No announcements yet.','bell')}</section></div>`;
}
function empty(message,ic='book'){return `<div class="empty"><span class="empty-icon">${icon(ic,25)}</span>${esc(message)}</div>`}
function studentsMarkup(){
 if(state.user.role==='student')return overviewMarkup();
 return `${pageHead('Students','Manage learner accounts and track the classes you are authorized to teach.','Add student','add-student')}
  <div class="panel"><div class="data-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Student ID</th><th>Class</th><th>Attendance today</th>${state.user.role==='admin'?'<th>Manage</th>':''}</tr></thead><tbody>
  ${state.students.map(s=>{const a=state.attendance.find(a=>a.studentId===s.id&&a.date===today());return `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.loginId)}</td><td><span class="student-badge">${esc(s.className)}-${esc(s.section)}</span></td><td>${a?`<span class="status ${a.status}">${esc(a.status)}</span>`:'<span style="color:#8297aa">Not marked</span>'}</td>${state.user.role==='admin'?`<td><button type="button" class="small-btn" data-action="edit-student" data-user-id="${esc(s.id)}">${icon('edit',14)} Edit student</button></td>`:''}</tr>`}).join('')||`<tr><td colspan="${state.user.role==='admin'?5:4}">${empty('No students yet. Use Add student to create the first account.','users')}</td></tr>`}
  </tbody></table></div></div><p class="helper">${state.user.role==='admin'?'Click Edit student to change a student’s name, class, section, login ID, or password, or delete the account.':'New students receive an easy-to-read ID and password. They can change passwords in Settings.'}</p>`;
}
function staffMarkup(){
 if(state.user.role!=='admin')return overviewMarkup();
 return `${pageHead('Staff directory','Create teaching accounts and assign classrooms.','Add teacher','add-staff')}
  <div class="panel"><div class="data-wrap"><table class="data-table"><thead><tr><th>Teacher</th><th>Staff ID</th><th>Assigned classes</th><th>Manage</th></tr></thead><tbody>${state.staff.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.loginId)}</td><td>${s.classes?.map(c=>`<span class="student-badge">${esc(c.className)}-${esc(c.section)}</span>`).join(' ')||'Not assigned'}</td><td><button type="button" class="small-btn" data-action="manage-account" data-user-id="${esc(s.id)}">${icon('key',14)} Manage account</button></td></tr>`).join('')||`<tr><td colspan="4">${empty('No teachers yet. Add the first staff account.','users')}</td></tr>`}</tbody></table></div></div><p class="helper">School admins can rename teachers, change IDs or passwords, and delete teacher accounts.</p>`;
}
function homeworkMarkup(){
 const canWrite=state.user.role!=='student';
 return `${pageHead('Homework','Assignments and upcoming due dates in one place.',canWrite?'New assignment':'', 'add-homework')}
 <div class="card-stack">${state.homework.length?state.homework.map(h=>`<article class="notice-card"><div class="notice-meta"><span>Class ${esc(h.className)}-${esc(h.section)} · ${esc(h.author)} · <span class="subject-label">${esc(h.subject||'General')}</span></span><span class="date-chip">Due ${esc(h.dueDate)}</span></div><h3>${esc(h.title)}</h3><p>${esc(h.details||'No additional instructions.')}</p></article>`).join(''):empty('No assignments posted for these classes yet.','book')}</div>`;
}
function attendanceMarkup(){
 if(state.user.role==='student'){
   const stats=attendanceStats();
   return `${pageHead('My attendance','Review your overall attendance and recorded days.')}
    <div class="attendance-summary"><div class="attendance-ring" style="--attendance-progress:${stats.percentage??0}%" aria-label="Overall attendance ${stats.percentage===null?'not yet recorded':stats.percentage+' percent'}"><div><strong>${stats.percentage===null?'—':stats.percentage+'%'}</strong><span>Overall attendance</span></div></div>
    <div class="summary-details"><h3>Attendance overview</h3><p>Calculated from days your school has marked—not weekends or unrecorded days.</p><div class="summary-split"><span><i class="legend-dot present"></i> Present <b>${stats.present}</b></span><span><i class="legend-dot absent"></i> Absent <b>${stats.absent}</b></span><span>Recorded days <b>${stats.total}</b></span></div></div></div>
    ${attendanceCalendarMarkup()}
    <section class="panel"><div class="panel-pad"><div class="panel-title"><h3>Attendance history</h3><span class="history-count">${state.attendance.length} recent records shown</span></div></div><div class="data-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
    ${[...state.attendance].sort((a,b)=>b.date.localeCompare(a.date)).map(a=>`<tr><td>${esc(a.date)}</td><td><span class="status ${a.status}">${esc(a.status)}</span></td></tr>`).join('')||`<tr><td colspan="2">${empty('No attendance recorded yet.','calendar')}</td></tr>`}</tbody></table></div></section>`;
 }
 return `${pageHead('Attendance','Mark students present or absent. Only authorized classes are available.')}
   <div class="sort-row" style="margin-bottom:18px"><label for="attendance-date" style="font-size:12px;color:var(--muted)">Choose date</label><input id="attendance-date" class="inline-control" type="date" value="${esc(state.attDate||today())}">
   <span class="helper">Changes are saved for the selected date.</span></div>
   <div class="panel"><div class="data-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Class</th><th>Status</th><th>Mark attendance</th></tr></thead><tbody>${state.students.map(s=>{
    const a=state.attendance.find(a=>a.studentId===s.id&&a.date===(state.attDate||today()));
    return `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.className)}-${esc(s.section)}</td><td>${a?`<span class="status ${a.status}">${a.status}</span>`:'Not marked'}</td><td><div class="action-line"><button class="small-btn" data-action="mark" data-student="${esc(s.id)}" data-status="present">${icon('check',13)} Present</button><button class="small-btn absent" data-action="mark" data-student="${esc(s.id)}" data-status="absent">Absent</button></div></td></tr>`;
   }).join('')||`<tr><td colspan="4">${empty('No students assigned to your classes.','users')}</td></tr>`}</tbody></table></div></div>`;
}
function announcementsMarkup(){
 return `${pageHead('Announcements','Important notices, updates and events from your school.',state.user.role!=='student'?'New notice':'','add-notice')}
  <div class="card-stack">${state.announcements.length?state.announcements.map(a=>`<article class="notice-card"><div class="notice-meta"><span>${esc(a.author)} · ${format(a.createdAt)}</span>${a.className?`<span class="date-chip">Class ${esc(a.className)}-${esc(a.section)}</span>`:'<span class="date-chip">Entire school</span>'}</div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></article>`).join(''):empty('Nothing has been announced yet.','bell')}</div>`;
}
function settingsMarkup(){const u=state.user;return `${pageHead('My account','Your profile and sign-in security.')}
   <div class="content-grid"><section class="panel panel-pad"><div class="panel-title"><h3>Account details</h3>${icon('person')}</div>
     ${[['Name',u.name],['Role',u.role],['School',u.schoolName],['School code',u.schoolCode],['Login ID',u.loginId],...(u.role==='student'?[['Class',`${u.className}-${u.section}`]]:[])]
     .map(([k,v])=>`<div class="list-item"><span style="width:105px;color:#8fa0b4">${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</section>
     <section class="panel panel-pad"><div class="panel-title"><h3>Security</h3>${icon('shield')}</div><p class="subline">Change your password regularly and never share your school account.</p>
     <button class="btn btn-secondary" data-action="change-password">${icon('edit')} Change password</button>
     <div style="margin-top:22px"><button class="btn btn-ghost" data-action="logout">${icon('logout')} Sign out</button></div></section></div>`;
}
function selectClassField(required=true){
 const choices=state.classes.filter(c=>c.className&&c.section);
 if(!choices.length) return `<div class="alert-note">No classes assigned. ${state.user.role==='admin'?'Enter a class and section manually when creating a teacher first.':'Ask your school admin to assign a class before adding students or homework.'}</div>`;
 return `<div class="field"><label for="classPair">Class and section</label><select class="control" id="classPair" name="classPair" ${required?'required':''}>
  <option value="">Choose a class</option>${choices.map(c=>`<option value="${esc(c.className)}|${esc(c.section)}">Class ${esc(c.className)} — ${esc(c.section)}</option>`).join('')}</select></div>`;
}
function creationCredentialFields(){return `<div class="account-reset"><h3>Login details (optional)</h3><p>Leave these blank for a short ID and a randomly generated, readable password. Or choose your own.</p>
  <div class="field"><label for="createLoginId">Login ID</label><input class="control" id="createLoginId" name="loginId" autocomplete="off" minlength="4" maxlength="24" pattern="[A-Za-z][A-Za-z0-9._-]{3,23}" placeholder="Auto: STU12345 or TCH12345"></div>
  <div class="field"><label for="createPassword">Password (6+ characters)</label><input class="control" id="createPassword" name="password" autocomplete="new-password" type="password" minlength="6" maxlength="128" placeholder="Auto: e.g. H7PK3-M9R2W"><button type="button" class="small-btn secret-toggle" data-action="toggle-secret" data-input-id="createPassword">Show password</button></div></div>`}
function modalMarkup(){
 const type=state.modal?.type,m=state.modal||{};
 let title='',content='';
 if(type==='student'){
  title='Add a student';content=`<p>Create an account in one of your authorized classes.</p><form id="create-student-form">${field('Student name','name','Full name')}${selectClassField()}${creationCredentialFields()}
    <button class="btn btn-primary btn-full" type="submit">${icon('plus')} Create student account</button></form>`;
 }else if(type==='staff'){
  title='Add a teacher';content=`<p>Teachers can only manage students in assigned classes.</p><form id="create-staff-form">${field('Teacher name','name','Full name')}
  <div class="form-grid">${field('Assign class (optional)','className','e.g. 10',false)}${field('Section (optional)','section','e.g. A',false)}</div>
  ${creationCredentialFields()}<button class="btn btn-primary btn-full" type="submit">${icon('plus')} Create staff account</button></form>`;
 }else if(type==='homework'){
  title='New assignment';content=`<form id="create-homework-form">${selectClassField()}
   ${field('Subject','subject','e.g. Mathematics')}${field('Title','title','e.g. Algebra practice')}${textArea('Instructions','details','Homework details...',false)}${field('Due date','dueDate','',true,'date',today())}
   <button class="btn btn-primary btn-full" type="submit">Publish homework</button></form>`;
 }else if(type==='notice'){
  title='Post an announcement';content=`<form id="create-notice-form">${field('Title','title','e.g. School assembly')}${textArea('Message','body','Write your announcement...')}
  <div class="field"><label for="notice-scope">Who should see this?</label><select name="scope" class="control" id="notice-scope">${state.user.role==='admin'?'<option value="">Entire school</option>':''}
  ${state.classes.map(c=>`<option value="${esc(c.className)}|${esc(c.section)}">Class ${esc(c.className)}-${esc(c.section)}</option>`).join('')}</select></div>
  <p class="helper">School admins can post across the school; teachers can post to assigned classes.</p>
  <button class="btn btn-primary btn-full" type="submit">Publish notice</button></form>`;
 }else if(type==='edit-student'){
  const a=m.account;
  title='Edit student details';
  content=`<div class="account-target"><span class="account-target-icon">${icon('person',21)}</span><div><strong>${esc(a.name)}</strong><small>Student · ${esc(state.user.schoolCode)}</small></div></div>
   <p>Update the student's name, class, section, login ID, or password. Changes are saved together.</p>
   <form id="edit-student-form">
    <div class="field"><label for="studentEditName">Full name</label><input class="control" id="studentEditName" name="name" type="text" required minlength="2" maxlength="90" value="${esc(a.name)}"></div>
    <div class="form-grid">
     <div class="field"><label for="studentEditClass">Class</label><input class="control" id="studentEditClass" name="className" type="text" required maxlength="12" value="${esc(a.className)}" placeholder="e.g. 10"></div>
     <div class="field"><label for="studentEditSection">Section</label><input class="control" id="studentEditSection" name="section" type="text" required maxlength="8" value="${esc(a.section)}" placeholder="e.g. A"></div>
    </div>
    <div class="account-reset"><h3>Login details</h3>
     <div class="field"><label for="studentEditLoginId">Student login ID</label><input class="control" id="studentEditLoginId" name="loginId" type="text" required minlength="4" maxlength="24" pattern="[A-Za-z][A-Za-z0-9._-]{3,23}" autocomplete="off" value="${esc(a.loginId)}"></div>
     <div class="field"><label for="studentEditPassword">New password (optional)</label><input class="control" id="studentEditPassword" name="newPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password" placeholder="Leave blank to keep the current password"><button type="button" class="small-btn secret-toggle" data-action="toggle-secret" data-input-id="studentEditPassword">Show password</button></div>
     <p class="helper">Leave the password blank to keep it unchanged. If you change the class, login ID, or password, the student will need to sign in again. Existing attendance history is kept.</p>
    </div>
    <button class="btn btn-primary btn-full" type="submit">${icon('check',17)} Save student details</button>
   </form>
   <div class="account-reset delete-zone"><h3>Delete student</h3><p>Permanent deletion also removes the student's attendance records.</p><button type="button" class="btn btn-danger btn-full" data-action="delete-account" data-user-id="${esc(a.id)}">Delete student…</button></div>`;
 }else if(type==='account'){
  const a=m.account;
  title='Manage '+(a.role==='student'?'student':'teacher');
  content=`<div class="account-target"><span class="account-target-icon">${icon('person',21)}</span><div><strong>${esc(a.name)}</strong><small>${a.role==='student'?'Student':'Teacher'} · ${esc(state.user.schoolCode)}</small></div></div>
   <form id="manage-name-form"><div class="field"><label for="managedName">Full name</label><input class="control" id="managedName" name="name" type="text" required minlength="2" maxlength="90" value="${esc(a.name)}"></div><button class="btn btn-primary btn-full" type="submit">${icon('edit',17)} Save name</button></form>
   <div class="account-reset"><h3>Login ID (username)</h3><form id="manage-login-form">
    <div class="field"><label for="managedLoginId">Student / teacher ID</label><input class="control" id="managedLoginId" name="loginId" type="text" required minlength="4" maxlength="24" pattern="[A-Za-z][A-Za-z0-9._-]{3,23}" autocomplete="off" value="${esc(a.loginId)}"></div>
    <p class="helper">4–24 characters, starting with a letter. Changing the ID signs the user out.</p>
    <button class="btn btn-secondary btn-full" type="submit">${icon('edit',17)} Save login ID</button></form></div>
   <div class="account-reset"><h3>Set a new password</h3><p>Leave blank for a short, readable random password (such as H7PK3-M9R2W), or choose a password of at least 6 characters. It will be shown once.</p>
    <form id="manage-password-form"><div class="field"><label for="managedPassword">New password (optional)</label><input class="control" id="managedPassword" name="newPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password" placeholder="Leave blank to generate"><button type="button" class="small-btn secret-toggle" data-action="toggle-secret" data-input-id="managedPassword">Show password</button></div>
     <button class="btn btn-secondary btn-full" type="submit">${icon('key',16)} Set new password</button></form>
    <p class="helper">Existing sessions are signed out. The user can change their password later in Settings—no forced change at login.</p></div>
   <div class="account-reset delete-zone"><h3>Delete account</h3><p>Deleting this user permanently removes their account and directly related records.</p><button type="button" class="btn btn-danger btn-full" data-action="delete-account" data-user-id="${esc(a.id)}">Delete ${a.role==='student'?'student':'teacher'}…</button></div>`;
 }else if(type==='delete-account'){
  const a=m.account;
  title='Delete '+(a.role==='student'?'student':'teacher')+'?';
  content=`<div class="account-target"><span class="account-target-icon">${icon('users',21)}</span><div><strong>${esc(a.name)}</strong><small>${esc(a.loginId)}</small></div></div>
   <div class="feedback" role="alert">This cannot be undone. The user's sessions and directly related records will be deleted. For a teacher, this includes homework and announcements they authored and attendance they recorded. For a student, this includes their attendance history.</div>
   <form id="delete-account-form"><div class="field"><label for="deleteConfirmation">Type DELETE to confirm</label><input class="control" id="deleteConfirmation" name="confirm" type="text" required pattern="DELETE" autocomplete="off" placeholder="DELETE"></div>
    <button class="btn btn-danger btn-full" type="submit">Permanently delete account</button></form>
    <button class="btn btn-secondary btn-full" type="button" data-action="${a.role==='student'?'edit-student':'manage-account'}" data-user-id="${esc(a.id)}">Cancel</button>`;
 }else if(type==='credentials'){
  title='Account created';content=`<div class="feedback success">${icon('check',16)} The account was created successfully.</div>
   <div class="credentials"><small>School code</small><strong>${esc(state.user.schoolCode)}</strong><small>Login ID</small><strong>${esc(m.loginId)}</strong>
   <small>Temporary password — shown only once</small><strong>${esc(m.password)}</strong></div>
   <p>Share these details privately with the account holder. They may change their password later in Settings.</p>
   <button class="btn btn-secondary btn-full" data-action="close-modal">Done</button>`;
 }else if(type==='password'){
  title='Change password';content=`<p>Choose a new password of at least 6 characters. You can do this anytime from Settings.</p>
   <form id="change-password-form">${field('Current password','oldPassword','Current or temporary password',true,'password')}${field('New password (6+ characters)','newPassword','Choose a strong password',true,'password')}
   <button class="btn btn-primary btn-full" type="submit">Update password</button></form>`;
 }
 return `<div class="modal-backdrop" role="presentation"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-top"><h2>${esc(title)}</h2>
 <button type="button" class="close" data-action="close-modal" aria-label="Close">${icon('close',18)}</button></div>
 ${state.modal.error?`<div class="feedback" role="alert">${esc(state.modal.error)}</div>`:''}${content}</div></div>`;
}
function render(){root.innerHTML=state.page==='app'?appMarkup():loginMarkup()}
function fromForm(form){return Object.fromEntries(new FormData(form).entries())}
async function submitSchoolRequest(values){
 // Keep a stable key when retrying. The Worker uses it to avoid duplicate requests
 // if it saved the request but the connection dropped before showing confirmation.
 if(!state.requestKey)state.requestKey=crypto.randomUUID();
 const response=await api('schools/register','POST',values);
 if(!response?.ok || response.user?.role!=='admin' || !response.schoolCode || !response.loginId)
   throw Error('The server did not confirm your new admin session. Please sign in using your saved credentials.');
 let sessionSaved=true;
 if(IS_REMOTE_API){
   if(!/^[a-f0-9]{64}$/i.test(response.sessionToken||''))
     throw Error('The server did not return a valid admin session. Sign in using your new credentials.');
   sessionToken=response.sessionToken;
   sessionSaved=saveToken(sessionToken);
 }
 state.user=response.user;state.demo=false;state.role='staff';state.page='app';state.section='overview';
 state.error='';state.success='';state.modal=null;state.requestFailed=false;state.requestKey=null;
 state.requestDraft={name:'',city:'',ownerName:'',ownerEmail:''};
 render();
 await loadData();
 showNotice('success','School created',sessionSaved
   ? 'Your admin account is ready and you are already signed in. Save your credentials before opening the dashboard.'
   : 'You are signed in for this tab, but browser storage is blocked. Copy your credentials before continuing; you may need them after refreshing.',
   [['School code',response.schoolCode],['Admin ID',response.loginId]],'Continue to dashboard');
}
function pair(value){const [className='',section='']=String(value||'').split('|');return {className,section}}
function openModal(type,accountId){
 if(type==='account'||type==='delete-account'||type==='edit-student'){
   if(state.user?.role!=='admin')return;
   const match=[...state.students,...state.staff].find(user=>user.id===accountId);
   if(!match)return notify('This account is no longer available. Refresh the page.','error');
   const role=state.students.some(s=>s.id===accountId)?'student':'staff';
   if(type==='edit-student'&&role!=='student')return notify('Only students can be edited here.','error');
   state.modal={type,account:{...match,role}};
 }else state.modal={type};
 render();
}
async function handleForm(event){
 const form=event.target;
 if(!(form instanceof HTMLFormElement)||!form.id)return;
 event.preventDefault();if(state.working)return;
 state.working=true;const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;
 const p=fromForm(form);
 try{
  if(form.id==='login-form'){
    const result=await api('auth/login','POST',{...p,role:state.role});
    if(IS_REMOTE_API){
      if(!/^[a-f0-9]{64}$/i.test(result.sessionToken||''))throw Error('Cloudflare did not return a valid sign-in session. Verify the allowed frontend origin.');
      if(!saveToken(result.sessionToken))throw Error('Your browser blocked session storage. Enable session storage to sign in.');
      sessionToken=result.sessionToken;
    }
    state.user=result.user;state.demo=false;state.page='app';state.section='overview';state.error='';
    render();await loadData()
  }else if(form.id==='request-form'){
    state.requestDraft={name:p.name||'',city:p.city||'',ownerName:p.ownerName||'',ownerEmail:p.ownerEmail||''};
    if(p.password!==p.confirmPassword)throw Error('Passwords do not match.');
    state.requestFailed=false;state.error='';
    await submitSchoolRequest({...state.requestDraft,password:p.password,confirmPassword:p.confirmPassword});
  }else if(form.id==='change-password-form'){
    if(state.demo){state.modal=null;notify('Demo passwords are not saved.');render()}
    else {await api('auth/password','POST',p);sessionToken='';saveToken('');state.user=null;state.page='login';state.error='';state.success='';state.modal=null;render();notify('Password changed. Sign in with your new password.')}
  }else if(form.id==='edit-student-form'){
    if(state.user.role!=='admin'||state.modal?.type!=='edit-student')throw Error('Only school admins can edit student details.');
    const a=state.modal.account;
    const details={
      name:String(p.name||'').trim(),
      className:String(p.className||'').trim(),
      section:String(p.section||'').trim().toUpperCase(),
      loginId:String(p.loginId||'').trim().toUpperCase()
    };
    if(details.name.length<2||details.name.length>90)throw Error('Student name must be 2–90 characters.');
    if(!details.className||details.className.length>12||!details.section||details.section.length>8)throw Error('Enter a valid class and section.');
    if(!/^[A-Z][A-Z0-9._-]{3,23}$/.test(details.loginId))throw Error('Login ID must be 4–24 characters, starting with a letter.');
    if(p.newPassword && (p.newPassword.length<6||p.newPassword.length>128))throw Error('New password must be 6–128 characters.');
    let result;
    if(state.demo){
      const target=demoData.students.find(x=>x.id===a.id);
      if(!target)throw Error('Student not found.');
      if([...demoData.students,...demoData.staff].some(x=>x.id!==a.id&&x.loginId.toUpperCase()===details.loginId))throw Error('Login ID already exists.');
      const mustSignOut=target.className!==details.className||target.section!==details.section||target.loginId!==details.loginId||!!p.newPassword;
      Object.assign(target,details);
      result={student:{...target},signedOut:mustSignOut,passwordChanged:!!p.newPassword};
    }else result=await api('admin/accounts','POST',{action:'updateStudent',userId:a.id,...details,...(p.newPassword?{newPassword:p.newPassword}:{})});
    state.modal=null;
    await loadData();render();
    showNotice('success','Student updated',
      `${details.name}'s details have been saved.${result.signedOut?' The student must sign in again.':''}${state.demo?' This was a demo-only edit.':''}`,
      [['Student ID',details.loginId],...(p.newPassword?[['New password',p.newPassword]]:[])]);
  }else if(form.id==='manage-name-form'){
    if(state.user.role!=='admin'||state.modal?.type!=='account')throw Error('Only school admins can rename accounts.');
    const a=state.modal.account;
    const name=String(p.name||'').trim();
    if(name.length<2||name.length>90)throw Error('Name must be 2–90 characters.');
    if(state.demo){const target=[...demoData.students,...demoData.staff].find(x=>x.id===a.id);if(!target)throw Error('Account not found.');target.name=name;}
    else await api('admin/accounts','POST',{action:'updateName',userId:a.id,name});
    state.modal=null;await loadData();render();showNotice('success','Name updated',`${name} was renamed successfully.`);
  }else if(form.id==='delete-account-form'){
    if(state.user.role!=='admin'||state.modal?.type!=='delete-account')throw Error('Only school admins can delete accounts.');
    const a=state.modal.account;
    if(p.confirm!=='DELETE')throw Error('Type DELETE to confirm.');
    if(state.demo){demoData.students=demoData.students.filter(x=>x.id!==a.id);demoData.staff=demoData.staff.filter(x=>x.id!==a.id);demoData.attendance=demoData.attendance.filter(x=>x.studentId!==a.id);demoData.homework=demoData.homework.filter(x=>x.author!==a.name);demoData.announcements=demoData.announcements.filter(x=>x.author!==a.name);}
    else await api('admin/accounts','POST',{action:'deleteAccount',userId:a.id,confirm:'DELETE'});
    state.modal=null;await loadData();render();showNotice('success','Account deleted',`${a.name} and directly related records were deleted.`);
  }else if(form.id==='manage-login-form'){
    if(state.user.role!=='admin'||state.modal?.type!=='account')throw Error('Only school admins can manage accounts.');
    const a=state.modal.account;
    const loginId=String(p.loginId||'').trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9._-]{3,23}$/.test(loginId))throw Error('Use a 4–24 character login ID that begins with a letter.');
    let result;
    if(state.demo){
      const accounts=[...demoData.students,...demoData.staff];
      if(accounts.some(x=>x.id!==a.id&&x.loginId.toUpperCase()===loginId))throw Error('Login ID already exists.');
      const target=accounts.find(x=>x.id===a.id);
      if(!target)throw Error('Account not found.');
      target.loginId=loginId;result={loginId};
    }else result=await api('admin/accounts','POST',{action:'updateLoginId',userId:a.id,loginId});
    state.modal=null;await loadData();render();
    showNotice('success','Login ID updated',state.demo?'Demo account updated. No live data changed.':'Use the new login ID for the next sign-in. Existing sessions have been signed out.',[['School code',state.user.schoolCode],['New login ID',result.loginId]]);
  }else if(form.id==='manage-password-form'){
    if(state.user.role!=='admin'||state.modal?.type!=='account')throw Error('Only school admins can manage accounts.');
    const a=state.modal.account;
    let result;
    if(state.demo)result={loginId:a.loginId,temporaryPassword:p.newPassword||'H7PK3-M9R2W'};
    else result=await api('admin/accounts','POST',{action:'resetPassword',userId:a.id,...(p.newPassword?{newPassword:p.newPassword}:{})});
    state.modal=null;await loadData();render();
    showNotice('success','Password updated',state.demo?'Demo reset only. No live password changed.':'Share this password privately. The user can sign in immediately and change it later in Settings.',[['School code',state.user.schoolCode],['Login ID',result.loginId],['New password',result.temporaryPassword]]);
  }else if(form.id==='create-student-form'||form.id==='create-staff-form'){
    const isStudent=form.id==='create-student-form';const data={name:p.name,...(isStudent?pair(p.classPair):{className:p.className,section:p.section}),...(p.loginId?{loginId:p.loginId}:{}),...(p.password?{password:p.password}:{})};
    let loginId,password;
    if(state.demo){
      const newId=p.loginId?.trim().toUpperCase()||(isStudent?'STU':'TCH')+(Math.floor(Math.random()*90000)+10000);
      const user={id:'demo-'+Math.random().toString(36).slice(2),loginId:newId,name:p.name.trim(),role:isStudent?'student':'staff',className:data.className||'',section:(data.section||'').toUpperCase()};
      if(isStudent){if(!user.className||!user.section)throw Error('Choose a class.');demoData.students.push(user)}
      else{user.classes=user.className&&user.section?[{className:user.className,section:user.section}]:[];demoData.staff.push(user)}
      loginId=newId;password=p.password||'H7PK3-M9R2W';
    }else{const response=await api(isStudent?'students':'staff','POST',data);loginId=response.user.loginId;password=response.temporaryPassword}
    state.modal=null;await loadData();render();showNotice('success','Account created','Save these credentials privately. The password is shown only once. Users may change it in Settings.',[['School code',state.user.schoolCode],['Login ID',loginId],['Password',password]]);
  }else if(form.id==='create-homework-form'){
    const data={...pair(p.classPair),subject:p.subject,title:p.title,details:p.details,dueDate:p.dueDate};
    if(!data.className)throw Error('Select a class.');
    if(state.demo)demoData.homework.unshift({...data,id:'demo-h-'+Date.now(),author:state.user.name,createdAt:Date.now()});
    else await api('homework','POST',data);
    state.modal=null;await loadData();notify('Homework published.');
  }else if(form.id==='create-notice-form'){
    const data={...pair(p.scope),title:p.title,body:p.body};
    if(state.user.role==='staff'&&!data.className)throw Error('Select an assigned class.');
    if(state.demo)demoData.announcements.unshift({...data,id:'demo-a-'+Date.now(),author:state.user.name,createdAt:Date.now()});
    else await api('announcements','POST',data);
    state.modal=null;await loadData();notify('Announcement published.');
  }
 }catch(err){
   const msg=err.message||'Something went wrong.';
   if(form.id==='request-form')state.requestFailed=true;
   if(state.modal){state.modal.error=msg;render()}else{state.error='';render();showNotice('error','Action failed',msg)}
 }finally{state.working=false;if(submit&&submit.isConnected)submit.disabled=false}
}
async function handleClick(event){
 const btn=event.target.closest('[data-action]');if(!btn)return;
 const action=btn.dataset.action;
 if(action==='role'){state.role=btn.dataset.role;state.error='';state.success='';render()}
 else if(action==='request'){state.page='request';state.error='';state.success='';render()}
 else if(action==='login'){state.page='login';state.error='';render()}
 else if(action==='check-api'){await checkBackend()}
 else if(action==='demo'){startDemo('staff')}
 else if(action==='switch-demo'){startDemo(btn.dataset.role)}
 else if(action==='navigate'){state.section=btn.dataset.section;state.modal=null;render()}
 else if(action==='calendar-prev'||action==='calendar-next'){state.calendarMonth=shiftMonth(state.calendarMonth,action==='calendar-prev'?-1:1);render()}
 else if(action==='edit-student'){openModal('edit-student',btn.dataset.userId)}
 else if(action==='manage-account'){openModal('account',btn.dataset.userId)}
 else if(action==='delete-account'){openModal('delete-account',btn.dataset.userId)}
 else if(action==='toggle-secret'){const input=document.getElementById(btn.dataset.inputId);if(input){input.type=input.type==='password'?'text':'password';btn.textContent=input.type==='password'?'Show password':'Hide password';}}
 else if(action==='add-student'){openModal('student')}
 else if(action==='add-staff'){openModal('staff')}
 else if(action==='add-homework'){openModal('homework')}
 else if(action==='add-notice'){openModal('notice')}
 else if(action==='change-password'){openModal('password')}
 else if(action==='close-modal'){state.modal=null;render()}
 else if(action==='logout'){
   if(!state.demo)try{await api('auth/logout','POST',{})}catch{}
   sessionToken='';saveToken('');state.demo=false;state.user=null;state.page='login';state.error='';state.modal=null;state.success='';render();
 }else if(action==='mark'){
   const studentId=btn.dataset.student,status=btn.dataset.status,date=state.attDate||today();
   try{
    if(state.demo){demoData.attendance=demoData.attendance.filter(a=>!(a.studentId===studentId&&a.date===date));demoData.attendance.push({studentId,date,status});}
    else await api('attendance','POST',{studentId,date,status});
    await loadData();notify('Attendance updated.');
   }catch(err){notify(err.message,'error')}
 }
}
root.addEventListener('click',handleClick);
root.addEventListener('input',event=>{
 const input=event.target;
 if(input.closest?.('#request-form')&&input.name&&Object.hasOwn(state.requestDraft,input.name)){
   state.requestDraft[input.name]=input.value;
   // Changing a request makes it a new submission, not a retry of the old one.
   state.requestKey=null;
 }
});
root.addEventListener('submit',handleForm);
root.addEventListener('change',async(event)=>{
 if(event.target.id!=='attendance-date')return;
 state.attDate=event.target.value;
 if(state.demo){syncDemo();render();return}
 try{const r=await api('attendance?date='+encodeURIComponent(state.attDate));state.attendance=r.attendance;render()}
 catch(err){notify(err.message,'error')}
});
async function init(){
 // File:// supports fictional data only. HTTPS hosting is required for API requests.
 render();
 await checkBackend();
 if(state.apiStatus!=='online')return;
 try{
  const result=await api('me');
  if(result.user){state.user=result.user;state.page='app';render();
    await loadData();return}
  if(IS_REMOTE_API && sessionToken){sessionToken='';saveToken('')}
 }catch(err){console.info('Coolage: saved session could not be restored.');}
 render();
}
init();
})();
