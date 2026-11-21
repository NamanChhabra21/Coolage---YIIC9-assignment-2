import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {pbkdf2Sync, randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';

function setup(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0002_homework_subject.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/0003_school_request_retry.sql',import.meta.url),'utf8'));
 const DB={
  prepare(sql){return{bind(...args){return{
   first:async()=>sqlite.prepare(sql).get(...args)??null,
   all:async()=>({results:sqlite.prepare(sql).all(...args)}),
   run:async()=>sqlite.prepare(sql).run(...args),
   _sql:sql,_args:args
  }}}},
  async batch(statements){
   sqlite.exec('BEGIN');
   try {const results=statements.map(s=>sqlite.prepare(s._sql).run(...s._args));sqlite.exec('COMMIT');return results;}
   catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
 };
 const env={DB,ASSETS:{fetch:async()=>new Response('static file')}};
 const one=randomUUID(),two=randomUUID(),stamp=Date.now();
 sqlite.prepare('INSERT INTO schools(id,code,name,city,created_at) VALUES(?,?,?,?,?)').run(one,'NORTH001','Northfield','Delhi',stamp);
 sqlite.prepare('INSERT INTO schools(id,code,name,city,created_at) VALUES(?,?,?,?,?)').run(two,'SOUTH002','Southfield','Delhi',stamp);
 function addUser(school,loginId,role,name,cls='',sect='',pwd='SamplePassword!123'){
  const userId=randomUUID(),salt=randomBytes(16).toString('hex'),iterations=100000;
  const hash=pbkdf2Sync(pwd,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
  sqlite.prepare(`INSERT INTO users(id,school_id,login_id,role,name,class_name,section,salt,password_hash,iterations,needs_password_change,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`).run(userId,school,loginId,role,name,cls,sect,salt,hash,iterations,stamp);
  return userId;
 }
 const teacher=addUser(one,'TCH001','staff','Teacher North');
 const student=addUser(one,'STU001','student','Learner North','10','A');
 const other=addUser(two,'STU002','student','Learner South','10','A');
 const admin=addUser(one,'ADM001','admin','Owner North');
 sqlite.prepare('INSERT INTO staff_classes(staff_id,school_id,class_name,section) VALUES(?,?,?,?)').run(teacher,one,'10','A');
 return {env,sqlite,one,two,teacher,student,other,admin};
}
const BASE='https://coolage.test';
async function req(env,path,method='GET',data,cookie){
 const request=new Request(BASE+path,{method,headers:{...(method!=='GET'?{'content-type':'application/json','origin':BASE}:{}),...(cookie?{cookie}:{})},body:method==='GET'?undefined:JSON.stringify(data)});
 const response=await worker.fetch(request,env);
 let json;try{json=await response.json()}catch{json={}};
 return {status:response.status,data:json,cookie:response.headers.get('set-cookie')};
}
async function signIn(env,schoolCode,loginId,role='staff',password='SamplePassword!123'){
 const out=await req(env,'/api/auth/login','POST',{schoolCode,loginId,role,password});
 return {...out,session:out.cookie?.match(/oc_session=([^;]+)/)?.[1]};
}
function cookie(session){return `oc_session=${session}`;}

test('health, unauthenticated session and school requests',async()=>{
 const {env,sqlite}=setup();
 assert.equal((await req(env,'/api/health')).status,200);
 assert.equal((await req(env,'/api/me')).data.user,null);
 const result=await req(env,'/api/school-requests','POST',{name:'Test School',city:'Delhi',ownerName:'Test Owner',ownerEmail:'owner@example.com'});
 assert.equal(result.status,201);
 assert.equal(sqlite.prepare('SELECT status FROM school_requests').get().status,'pending');
});

test('school scoped accounts and teacher permissions',async()=>{
 const {env,sqlite,two}=setup();
 const teacher=await signIn(env,'NORTH001','TCH001');
 assert.equal(teacher.status,200);assert.equal(teacher.data.user.role,'staff');
 const auth=cookie(teacher.session);
 let r=await req(env,'/api/students','POST',{name:'Maya Learner',className:'10',section:'B'},auth);
 assert.equal(r.status,403);
 r=await req(env,'/api/students','POST',{name:'Maya Learner',className:'10',section:'A'},auth);
 assert.equal(r.status,201);assert.match(r.data.user.loginId,/^STU\d+$/);assert.match(r.data.user.loginId,/^STU[0-9]{5}$/);assert.match(r.data.temporaryPassword,/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
 const learners=await req(env,'/api/students','GET',undefined,auth);
 assert.equal(learners.status,200);assert.equal(learners.data.students.length,2);
 const sid=r.data.user.id;
 const sidLogin=await signIn(env,'NORTH001',r.data.user.loginId,'student',r.data.temporaryPassword);
 assert.equal(sidLogin.status,200);assert.equal(sidLogin.data.user.needsPasswordChange,false);
 assert.equal((await req(env,'/api/homework','GET',undefined,cookie(sidLogin.session))).status,200);
 assert.equal((await req(env,'/api/students','POST',{name:'Bad'},cookie(sidLogin.session))).status,403);
 assert.equal((await req(env,'/api/homework','POST',{title:'Test task',subject:'Mathematics',className:'10',section:'B',dueDate:'2026-11-21'},auth)).status,403);
 assert.equal((await req(env,'/api/homework','POST',{title:'Test task',subject:'Mathematics',className:'10',section:'A',dueDate:'2026-11-21'},auth)).status,201);
 const schoolBUser=sqlite.prepare('SELECT id FROM users WHERE school_id=?').get(two);
 assert.ok(schoolBUser.id);
 assert.equal((await req(env,'/api/auth/login','POST',{schoolCode:'SOUTH002',loginId:r.data.user.loginId,role:'student',password:r.data.temporaryPassword})).status,401);
 assert.equal((await req(env,'/api/staff','POST',{name:'Unauthorized'},auth)).status,403);
});

test('student sees only same-school assigned homework and notices',async()=>{
 const {env,sqlite,one,two,admin,other}=setup();
 const teacher=await signIn(env,'NORTH001','TCH001');
 const teacherCookie=cookie(teacher.session);
 assert.equal((await req(env,'/api/announcements','POST',{title:'Class task',body:'Bring notebook',className:'10',section:'A'},teacherCookie)).status,201);
 assert.equal((await req(env,'/api/announcements','POST',{title:'Whole school',body:'All students'},teacherCookie)).status,403);
 const adminSession=await signIn(env,'NORTH001','ADM001');
 const adminCookie=cookie(adminSession.session);
 assert.equal((await req(env,'/api/announcements','POST',{title:'General notice',body:'Welcome to school'},adminCookie)).status,201);
 const student=await signIn(env,'NORTH001','STU001','student');
 const notices=await req(env,'/api/announcements','GET',undefined,cookie(student.session));
 assert.equal(notices.status,200);assert.equal(notices.data.announcements.length,2);
 assert.equal((await req(env,'/api/announcements','POST',{title:'Fake notice',body:'From student'},cookie(student.session))).status,403);
 assert.equal((await req(env,'/api/attendance','POST',{studentId:other,status:'present',date:'2026-11-15'},adminCookie)).status,404);
 assert.equal((await req(env,'/api/attendance','POST',{studentId:sqlite.prepare("SELECT id FROM users WHERE school_id=? AND role='student'").get(one).id,status:'present',date:'2026-11-15'},adminCookie)).status,200);
});

test('rejects cross-origin mutations',async()=>{
 const {env}=setup();
 const res=await worker.fetch(new Request(BASE+'/api/auth/login',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}),env);
 assert.equal(res.status,403);
});

test('homework subject persists and is visible to student in the same school',async()=>{
 const {env,sqlite}=setup();
 const teacher=await signIn(env,'NORTH001','TCH001');
 const staffCookie=cookie(teacher.session);
 assert.equal((await req(env,'/api/homework','POST',{title:'Essay',className:'10',section:'A',dueDate:'2026-12-02'},staffCookie)).status,400);
 const created=await req(env,'/api/homework','POST',{title:'Essay',subject:'English',className:'10',section:'A',dueDate:'2026-12-02'},staffCookie);
 assert.equal(created.status,201);
 assert.equal(sqlite.prepare('SELECT subject FROM homework').get().subject,'English');
 const learner=await signIn(env,'NORTH001','STU001','student');
 const visible=await req(env,'/api/homework','GET',undefined,cookie(learner.session));
 assert.equal(visible.data.homework.length,1);
 assert.equal(visible.data.homework[0].subject,'English');
 const south=await signIn(env,'SOUTH002','STU002','student');
 const hidden=await req(env,'/api/homework','GET',undefined,cookie(south.session));
 assert.equal(hidden.data.homework.length,0);
});

test('student attendance summary reflects all recorded days but never unmarked days',async()=>{
 const {env,sqlite,one,student}=setup();
 const admin=await signIn(env,'NORTH001','ADM001','staff');
 const adminCookie=cookie(admin.session);
 for(const [date,status] of [['2026-11-11','present'],['2026-11-12','absent'],['2026-11-13','present']]){
  const marked=await req(env,'/api/attendance','POST',{studentId:student,date,status},adminCookie);
  assert.equal(marked.status,200);
 }
 const learner=await signIn(env,'NORTH001','STU001','student');
 const view=await req(env,'/api/attendance','GET',undefined,cookie(learner.session));
 assert.equal(view.status,200);
 assert.deepEqual(view.data.summary,{total:3,present:2,absent:1});
 assert.equal(view.data.attendance.length,3);
 const other=await signIn(env,'SOUTH002','STU002','student');
 const otherView=await req(env,'/api/attendance','GET',undefined,cookie(other.session));
 assert.deepEqual(otherView.data.summary,{total:0,present:0,absent:0});
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM attendance WHERE school_id=?').get(one).n,3);
});


test('retrying school registration with the same key does not duplicate the pending request',async()=>{
 const {env,sqlite}=setup();
 const requestKey='11111111-1111-4111-8111-111111111111';
 const payload={requestKey,name:'Riverview College',city:'Delhi',ownerName:'School Owner',ownerEmail:'owner@school.example'};
 assert.equal((await req(env,'/api/school-requests','POST',payload)).status,201);
 const retry=await req(env,'/api/school-requests','POST',payload);
 assert.equal(retry.status,201);
 assert.equal(retry.data.ok,true);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM school_requests WHERE request_key=?').get(requestKey).n,1);
 const changed=await req(env,'/api/school-requests','POST',{...payload,name:'Completely Different School'});
 assert.equal(changed.status,409);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM school_requests').get().n,1);
});

// The split-host deployment is deliberately allowlisted; it never reflects
// an arbitrary Origin and never depends on cross-site cookies.
test('approved InfinityFree origin gets explicit CORS and a bearer session',async()=>{
 const {env}=setup();
 env.FRONTEND_ORIGIN='https://coolage.infinityfreeapp.com';
 const origin=env.FRONTEND_ORIGIN;
 const preflight=await worker.fetch(new Request(BASE+'/api/auth/login',{method:'OPTIONS',headers:{
  origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'
 }}),env);
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
 const external=async(path,method='GET',data,sessionToken)=>{
  const headers={origin,...(sessionToken?{authorization:'Bearer '+sessionToken}:{}),...(method!=='GET'?{'content-type':'application/json'}:{})};
  const response=await worker.fetch(new Request(BASE+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(data)}),env);
  return {response,body:await response.json()};
 };
 const login=await external('/api/auth/login','POST',{schoolCode:'NORTH001',loginId:'TCH001',role:'staff',password:'SamplePassword!123'});
 assert.equal(login.response.status,200);
 assert.equal(login.response.headers.get('access-control-allow-origin'),origin);
 assert.equal(login.response.headers.get('set-cookie'),null);
 assert.match(login.body.sessionToken,/^[a-f0-9]{64}$/);
 const session=login.body.sessionToken;
 const me=await external('/api/me','GET',undefined,session);
 assert.equal(me.body.user.role,'staff');
 assert.equal(me.response.headers.get('access-control-allow-origin'),origin);
 const students=await external('/api/students','GET',undefined,session);
 assert.equal(students.body.students.length,1);
 const byCookie=await worker.fetch(new Request(BASE+'/api/me',{headers:{origin,cookie:'oc_session='+session}}),env);
 assert.equal((await byCookie.json()).user,null,'cross-origin cookies cannot authenticate');
 const logout=await external('/api/auth/logout','POST',{},session);
 assert.equal(logout.body.ok,true);
 assert.equal((await external('/api/me','GET',undefined,session)).body.user,null,'logout must revoke bearer token');
});

test('unapproved origin cannot register, log in, or read sensitive records',async()=>{
 const {env}=setup();
 env.FRONTEND_ORIGIN='https://coolage.infinityfreeapp.com';
 for(const method of ['GET','POST','OPTIONS']){
  const response=await worker.fetch(new Request(BASE+'/api/'+(method==='GET'?'me':'auth/login'),{method,headers:{
   origin:'https://attacker.example',...(method==='POST'?{'content-type':'application/json'}:{}),
   ...(method==='OPTIONS'?{'access-control-request-method':'POST'}:{})
  },body:method==='POST'?'{}':undefined}),env);
  assert.equal(response.status,403);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
 }
});

test('approved remote frontend can retry school requests but not create users without auth',async()=>{
 const {env,sqlite}=setup();
 env.FRONTEND_ORIGIN='https://coolage.infinityfreeapp.com';
 const data={requestKey:'22222222-2222-4222-8222-222222222222',name:'Meadow College',ownerName:'Demo Owner',ownerEmail:'owner@example.org',city:'Delhi'};
 for(let i=0;i<2;i++){
  const response=await worker.fetch(new Request(BASE+'/api/school-requests',{method:'POST',headers:{origin:env.FRONTEND_ORIGIN,'content-type':'application/json'},body:JSON.stringify(data)}),env);
  assert.equal(response.status,201);
  assert.equal((await response.json()).ok,true);
 }
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM school_requests WHERE request_key=?').get(data.requestKey).total,1);
 const denied=await worker.fetch(new Request(BASE+'/api/students',{method:'POST',headers:{origin:env.FRONTEND_ORIGIN,'content-type':'application/json'},body:JSON.stringify({name:'Unauthorised'})}),env);
 assert.equal(denied.status,401);
});

test('school creation immediately authenticates the admin with an HttpOnly cookie',async()=>{
 const {env,sqlite}=setup();
 const input={name:'Auto Login Academy',city:'Delhi',ownerName:'Owner Example',ownerEmail:'autologin@example.com',password:'abc123456',confirmPassword:'abc123456'};
 const created=await req(env,'/api/schools/register','POST',input);
 assert.equal(created.status,201);
 assert.equal(created.data.user.role,'admin');
 assert.equal(created.data.user.schoolCode,created.data.schoolCode);
 assert.equal(created.data.user.loginId,created.data.loginId);
 assert.equal(created.data.user.schoolName,input.name);
 assert.equal(created.data.user.needsPasswordChange,false);
 assert.equal(created.data.sessionToken,undefined,'same-origin response must not expose the token');
 assert.match(created.cookie,/^oc_session=[a-f0-9]{64};/);
 assert.match(created.cookie,/HttpOnly/);
 assert.match(created.cookie,/SameSite=Lax/);
 assert.match(created.cookie,/Secure/);
 const authCookie=cookie(created.cookie.match(/oc_session=([^;]+)/)[1]);
 const me=await req(env,'/api/me','GET',undefined,authCookie);
 assert.equal(me.status,200);
 assert.equal(me.data.user.role,'admin');
 assert.equal(me.data.user.loginId,created.data.loginId);
 const staff=await req(env,'/api/staff','GET',undefined,authCookie);
 assert.equal(staff.status,200,'admin should have immediate dashboard permissions');
 const session=sqlite.prepare('SELECT COUNT(*) AS n FROM sessions ss JOIN users u ON ss.user_id=u.id WHERE u.login_id=?').get(created.data.loginId);
 assert.equal(session.n,1);
 const logout=await req(env,'/api/auth/logout','POST',{},authCookie);
 assert.equal(logout.status,200);
 assert.equal((await req(env,'/api/me','GET',undefined,authCookie)).data.user,null);
});

test('approved external frontend gets a registration bearer session without a cookie',async()=>{
 const {env}=setup();
 env.FRONTEND_ORIGIN='https://example-school-frontend.test';
 const input={name:'External Frontend Academy',ownerName:'Demo Owner',ownerEmail:'remote@example.com',city:'Delhi',password:'abc123456',confirmPassword:'abc123456'};
 const response=await worker.fetch(new Request(BASE+'/api/schools/register',{method:'POST',headers:{origin:env.FRONTEND_ORIGIN,'content-type':'application/json'},body:JSON.stringify(input)}),env);
 const data=await response.json();
 assert.equal(response.status,201);
 assert.equal(response.headers.get('access-control-allow-origin'),env.FRONTEND_ORIGIN);
 assert.equal(response.headers.get('set-cookie'),null);
 assert.match(data.sessionToken,/^[a-f0-9]{64}$/);
 assert.equal(data.user.role,'admin');
 const me=await worker.fetch(new Request(BASE+'/api/me',{headers:{origin:env.FRONTEND_ORIGIN,authorization:'Bearer '+data.sessionToken}}),env);
 assert.equal((await me.json()).user.loginId,data.loginId);
 const cookieOnly=await worker.fetch(new Request(BASE+'/api/me',{headers:{origin:env.FRONTEND_ORIGIN,cookie:'oc_session='+data.sessionToken}}),env);
 assert.equal((await cookieOnly.json()).user,null);
});

test('failed school registration creates neither school nor session',async()=>{
 const {env,sqlite}=setup();
 const input={name:'Failed Registration School',ownerName:'Owner Example',ownerEmail:'failure@example.com',password:'abc123456',confirmPassword:'different'};
 const created=await req(env,'/api/schools/register','POST',input);
 assert.equal(created.status,400);
 assert.equal(created.cookie,null);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM schools').get().n,2);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
});

test('automatic registration creates school and admin with chosen password',async()=>{
 const {env,sqlite}=setup();
 const input={name:'Demo Academy',city:'Delhi',ownerName:'Demo Owner',ownerEmail:'demo@example.com',password:'ExamplePassphrase!123',confirmPassword:'ExamplePassphrase!123'};
 const result=await req(env,'/api/schools/register','POST',input);
 assert.equal(result.status,201);
 assert.match(result.data.schoolCode,/^SCH[A-F0-9]{10}$/);
 assert.match(result.data.loginId,/^ADM[A-F0-9]{8}$/);
 assert.equal(sqlite.prepare('SELECT status FROM school_requests WHERE owner_email=?').get(input.ownerEmail).status,'approved');
 const admin=await signIn(env,result.data.schoolCode,result.data.loginId,'staff',input.password);
 assert.equal(admin.status,200);
 assert.equal(admin.data.user.role,'admin');
 assert.equal(admin.data.user.needsPasswordChange,false);
 assert.equal((await req(env,'/api/schools/register','POST',input)).status,429);
 assert.equal((await req(env,'/api/schools/register','POST',{...input,confirmPassword:'not matching'})).status,400);
});


test('six-character school admin password is accepted and five-character password is rejected',async()=>{
 const {env}=setup();
 const details={name:'Six Character Academy',city:'Delhi',ownerName:'Example Owner',ownerEmail:'six@example.com'};
 const short=await req(env,'/api/schools/register','POST',{...details,password:'abcde',confirmPassword:'abcde'});
 assert.equal(short.status,400);
 const registered=await req(env,'/api/schools/register','POST',{...details,password:'abc123',confirmPassword:'abc123'});
 assert.equal(registered.status,201);
 const login=await signIn(env,registered.data.schoolCode,registered.data.loginId,'staff','abc123');
 assert.equal(login.status,200);
});


test('Login and school registration do not require CAPTCHA tokens',async()=>{
 const {env}=setup();
 const payload={schoolCode:'NORTH001',loginId:'TCH001',role:'staff',password:'SamplePassword!123'};
 assert.equal((await req(env,'/api/auth/login','POST',payload)).status,200);
 const details={name:'Test Academy',city:'Delhi',ownerName:'Test Owner',ownerEmail:'test@example.com',password:'abc123',confirmPassword:'abc123'};
 assert.equal((await req(env,'/api/schools/register','POST',details)).status,201);
});

test('admin can rename a student login ID; old ID and active sessions stop working',async()=>{
 const {env,sqlite,student}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const learner=await signIn(env,'NORTH001','STU001','student');
 const adminCookie=cookie(admin.session),learnerCookie=cookie(learner.session);
 assert.equal((await req(env,'/api/me','GET',undefined,learnerCookie)).data.user.loginId,'STU001');
 const changed=await req(env,'/api/admin/accounts','POST',{
   action:'updateLoginId',userId:student,loginId:'stu.2026_01'
 },adminCookie);
 assert.equal(changed.status,200);
 assert.equal(changed.data.loginId,'STU.2026_01');
 assert.equal(sqlite.prepare('SELECT login_id FROM users WHERE id=?').get(student).login_id,'STU.2026_01');
 assert.equal((await req(env,'/api/me','GET',undefined,learnerCookie)).data.user,null);
 assert.equal((await signIn(env,'NORTH001','STU001','student')).status,401);
 assert.equal((await signIn(env,'NORTH001','STU.2026_01','student')).status,200);
 assert.equal((await req(env,'/api/students','GET',undefined,adminCookie)).data.students.find(s=>s.id===student).loginId,'STU.2026_01');
 const unchanged=await req(env,'/api/admin/accounts','POST',{action:'updateLoginId',userId:student,loginId:'stu.2026_01'},adminCookie);
 assert.equal(unchanged.status,200);
 assert.equal(unchanged.data.message,'Login ID is unchanged.');
});

test('admin account management rejects teachers, students, admins, other schools, invalid IDs and duplicates',async()=>{
 const {env,sqlite,student,teacher,admin:adminId,other}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const adminCookie=cookie(admin.session);
 const teacherLogin=await signIn(env,'NORTH001','TCH001');
 const studentLogin=await signIn(env,'NORTH001','STU001','student');
 for(const who of [teacherLogin,studentLogin]){
   assert.equal((await req(env,'/api/admin/accounts','POST',{action:'resetPassword',userId:student},cookie(who.session))).status,403);
   assert.equal((await req(env,'/api/admin/accounts','POST',{action:'updateLoginId',userId:student,loginId:'STU999'},cookie(who.session))).status,403);
 }
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'resetPassword',userId:other},adminCookie)).status,404);
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'updateLoginId',userId:adminId,loginId:'ADMHACK'},adminCookie)).status,404);
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'resetPassword',userId:'bad'},adminCookie)).status,400);
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'updateLoginId',userId:student,loginId:'TCH001'},adminCookie)).status,409);
 for(const invalid of ['ab','1BADNAME','A B C','OVER_24_CHARACTER_LOGIN_ID'] ){
   assert.equal((await req(env,'/api/admin/accounts','POST',{action:'updateLoginId',userId:student,loginId:invalid},adminCookie)).status,400);
 }
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'resetPassword',userId:student,newPassword:'short'},adminCookie)).status,400);
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'what',userId:student},adminCookie)).status,400);
 assert.equal(sqlite.prepare('SELECT login_id FROM users WHERE id=?').get(student).login_id,'STU001');
 assert.equal(sqlite.prepare('SELECT login_id FROM users WHERE id=?').get(other).login_id,'STU002');
 assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get(adminId).role,'admin');
});

test('admin can reset teacher password; old password and sessions revoked without mandatory change',async()=>{
 const {env,sqlite,teacher}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const teacherLogin=await signIn(env,'NORTH001','TCH001');
 const result=await req(env,'/api/admin/accounts','POST',{action:'resetPassword',userId:teacher},cookie(admin.session));
 assert.equal(result.status,200);
 assert.match(result.data.temporaryPassword,/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
 assert.equal(result.data.loginId,'TCH001');
 assert.equal((await req(env,'/api/me','GET',undefined,cookie(teacherLogin.session))).data.user,null);
 assert.equal((await signIn(env,'NORTH001','TCH001')).status,401);
 const newSignIn=await signIn(env,'NORTH001','TCH001','staff',result.data.temporaryPassword);
 assert.equal(newSignIn.status,200);
 assert.equal(newSignIn.data.user.needsPasswordChange,false);
 assert.equal((await req(env,'/api/students','GET',undefined,cookie(newSignIn.session))).status,200);
 const changed=await req(env,'/api/auth/password','POST',{
   oldPassword:result.data.temporaryPassword,newPassword:'NewPassword123!'
 },cookie(newSignIn.session));
 assert.equal(changed.status,200);
 assert.equal((await signIn(env,'NORTH001','TCH001','staff','NewPassword123!')).status,200);
 assert.equal(sqlite.prepare('SELECT needs_password_change FROM users WHERE id=?').get(teacher).needs_password_change,0);
 // Neither the directory nor account update exposes existing password hashes or salts.
 const directory=(await req(env,'/api/staff','GET',undefined,cookie(admin.session))).data.staff;
 assert.equal(Object.hasOwn(directory[0],'password_hash'),false);
});

test('admin may set a six-character temporary password and resets a locked account',async()=>{
 const {env,sqlite,student}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 sqlite.prepare('UPDATE users SET failed_logins=4,locked_until=? WHERE id=?').run(Date.now()+3600000,student);
 const res=await req(env,'/api/admin/accounts','POST',{
   action:'resetPassword',userId:student,newPassword:'abc123'
 },cookie(admin.session));
 assert.equal(res.status,200);
 assert.equal(res.data.temporaryPassword,'abc123');
 const learner=await signIn(env,'NORTH001','STU001','student','abc123');
 assert.equal(learner.status,200);
 assert.equal(learner.data.user.needsPasswordChange,false);
 const record=sqlite.prepare('SELECT failed_logins,locked_until,password_hash FROM users WHERE id=?').get(student);
 assert.equal(record.failed_logins,0);assert.equal(record.locked_until,0);
 assert.notEqual(record.password_hash,'abc123');
});


test('admins can change student and teacher display names without changing login IDs',async()=>{
 const {env,sqlite,student,teacher}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const adminCookie=cookie(admin.session);
 const signed=await signIn(env,'NORTH001','STU001','student');
 for(const [userId,name] of [[student,'Priya Learner'],[teacher,'Noor Teacher']]){
   const renamed=await req(env,'/api/admin/accounts','POST',{action:'updateName',userId,name},adminCookie);
   assert.equal(renamed.status,200);assert.equal(renamed.data.name,name);
   assert.equal(sqlite.prepare('SELECT name FROM users WHERE id=?').get(userId).name,name);
 }
 assert.equal((await req(env,'/api/me','GET',undefined,cookie(signed.session))).data.user.name,'Priya Learner');
 assert.equal((await req(env,'/api/students','GET',undefined,adminCookie)).data.students[0].name,'Priya Learner');
 assert.equal((await req(env,'/api/staff','GET',undefined,adminCookie)).data.staff[0].name,'Noor Teacher');
 for(const name of ['', 'a', 'x'.repeat(91)]){
   assert.equal((await req(env,'/api/admin/accounts','POST',{action:'updateName',userId:student,name},adminCookie)).status,400);
 }
});

test('admins can create simple teacher and student IDs, or choose initial login ID and password',async()=>{
 const {env,sqlite}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const auth=cookie(admin.session);
 const teacher=await req(env,'/api/staff','POST',{name:'New Teacher',className:'10',section:'A'},auth);
 assert.equal(teacher.status,201);
 assert.match(teacher.data.user.loginId,/^TCH[0-9]{5}$/);
 assert.match(teacher.data.temporaryPassword,/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
 const student=await req(env,'/api/students','POST',{name:'New Student',className:'10',section:'A',loginId:'sara123',password:'abc123'},auth);
 assert.equal(student.status,201);
 assert.equal(student.data.user.loginId,'SARA123');
 assert.equal(student.data.temporaryPassword,'abc123');
 const signed=await signIn(env,'NORTH001','SARA123','student','abc123');
 assert.equal(signed.status,200);
 assert.equal(signed.data.user.needsPasswordChange,false);
 assert.equal((await req(env,'/api/attendance','GET',undefined,cookie(signed.session))).status,200);
 assert.equal(sqlite.prepare('SELECT needs_password_change FROM users WHERE id=?').get(student.data.user.id).needs_password_change,0);
 assert.equal((await req(env,'/api/students','POST',{name:'Another',className:'10',section:'A',loginId:'sara123'},auth)).status,409);
 assert.equal((await req(env,'/api/students','POST',{name:'Another',className:'10',section:'A',loginId:'a'},auth)).status,400);
 assert.equal((await req(env,'/api/students','POST',{name:'Another',className:'10',section:'A',password:'12345'},auth)).status,400);
});

test('legacy must-change flag no longer blocks dashboard, password change remains voluntary',async()=>{
 const {env,sqlite,student}=setup();
 sqlite.prepare('UPDATE users SET needs_password_change=1 WHERE id=?').run(student);
 const learner=await signIn(env,'NORTH001','STU001','student');
 const auth=cookie(learner.session);
 assert.equal(learner.status,200);
 assert.equal((await req(env,'/api/homework','GET',undefined,auth)).status,200);
 assert.equal((await req(env,'/api/attendance','GET',undefined,auth)).status,200);
 const changed=await req(env,'/api/auth/password','POST',{oldPassword:'SamplePassword!123',newPassword:'student123'},auth);
 assert.equal(changed.status,200);
 assert.equal((await signIn(env,'NORTH001','STU001','student','student123')).status,200);
});

test('only admins can delete student accounts with confirmation; attendance and sessions are removed',async()=>{
 const {env,sqlite,student,other,one}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const auth=cookie(admin.session);
 const signed=await signIn(env,'NORTH001','STU001','student');
 const teacher=await signIn(env,'NORTH001','TCH001');
 const marked=await req(env,'/api/attendance','POST',{studentId:student,date:'2026-11-15',status:'present'},cookie(teacher.session));
 assert.equal(marked.status,200);
 const input={action:'deleteAccount',userId:student,confirm:'DELETE'};
 assert.equal((await req(env,'/api/admin/accounts','POST',{...input,confirm:'delete'},auth)).status,400);
 assert.equal((await req(env,'/api/admin/accounts','POST',input,cookie(teacher.session))).status,403);
 assert.equal((await req(env,'/api/admin/accounts','POST',{...input,userId:other},auth)).status,404);
 assert.equal((await req(env,'/api/admin/accounts','POST',input,auth)).status,200);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').get(student).n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM attendance WHERE student_id=?').get(student).n,0);
 assert.equal((await req(env,'/api/me','GET',undefined,cookie(signed.session))).data.user,null);
 assert.equal((await signIn(env,'NORTH001','STU001','student')).status,401);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users WHERE id=?').get(other).n,1);
 assert.equal((await req(env,'/api/students','GET',undefined,auth)).data.students.length,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM schools WHERE id=?').get(one).n,1);
});

test('deleting teacher cleans authored homework, notices, marked attendance and class assignments',async()=>{
 const {env,sqlite,teacher,student,admin:owner}=setup();
 const teacherSession=await signIn(env,'NORTH001','TCH001');
 const teacherCookie=cookie(teacherSession.session);
 const admin=await signIn(env,'NORTH001','ADM001');
 const auth=cookie(admin.session);
 assert.equal((await req(env,'/api/homework','POST',{subject:'Math',title:'Review fractions',className:'10',section:'A',dueDate:'2026-11-28'},teacherCookie)).status,201);
 assert.equal((await req(env,'/api/announcements','POST',{title:'Bring notebook',body:'Bring your notebook',className:'10',section:'A'},teacherCookie)).status,201);
 assert.equal((await req(env,'/api/attendance','POST',{studentId:student,date:'2026-11-16',status:'present'},teacherCookie)).status,200);
 assert.equal((await req(env,'/api/admin/accounts','POST',{action:'deleteAccount',userId:owner,confirm:'DELETE'},auth)).status,404);
 const deleted=await req(env,'/api/admin/accounts','POST',{action:'deleteAccount',userId:teacher,confirm:'DELETE'},auth);
 assert.equal(deleted.status,200);
 for(const [table,key] of [['users','id'],['homework','created_by'],['announcements','created_by'],['attendance','marked_by'],['staff_classes','staff_id'],['sessions','user_id']]){
   assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${key}=?`).get(teacher).n,0,table);
 }
 assert.equal((await req(env,'/api/me','GET',undefined,teacherCookie)).data.user,null);
 assert.equal((await req(env,'/api/students','GET',undefined,auth)).data.students.length,1);
});

test('teachers and students cannot rename, reset, or delete other accounts',async()=>{
 const {env,student}=setup();
 const teacher=await signIn(env,'NORTH001','TCH001');
 const learner=await signIn(env,'NORTH001','STU001','student');
 for(const actor of [teacher,learner]){
   for(const payload of [{action:'updateName',userId:student,name:'Other'},
     {action:'updateLoginId',userId:student,loginId:'STU2026'},
     {action:'resetPassword',userId:student,newPassword:'abc123'},
     {action:'deleteAccount',userId:student,confirm:'DELETE'}]){
     assert.equal((await req(env,'/api/admin/accounts','POST',payload,cookie(actor.session))).status,403);
   }
 }
});

test('admin edits all student details at once and keeps attendance records',async()=>{
 const {env,sqlite,one,student}=setup();
 const adm=await signIn(env,'NORTH001','ADM001');
 const auth=cookie(adm.session);
 const learner=await signIn(env,'NORTH001','STU001','student');
 const marked=await req(env,'/api/attendance','POST',{studentId:student,status:'present',date:'2026-11-15'},auth);
 assert.equal(marked.status,200);
 const edited=await req(env,'/api/admin/accounts','POST',{
  action:'updateStudent',userId:student,name:'Edited Student',className:'11',section:'b',loginId:'NEWSTUDENT01'
 },auth);
 assert.equal(edited.status,200,JSON.stringify(edited.data));
 assert.deepEqual(edited.data.student,{id:student,name:'Edited Student',className:'11',section:'B',loginId:'NEWSTUDENT01'});
 assert.equal(edited.data.signedOut,true);
 assert.equal(edited.data.passwordChanged,false);
 const row=sqlite.prepare('SELECT name,class_name,section,login_id FROM users WHERE id=?').get(student);
 assert.deepEqual({...row},{name:'Edited Student',class_name:'11',section:'B',login_id:'NEWSTUDENT01'});
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM attendance WHERE student_id=?').get(student).n,1);
 assert.equal((await req(env,'/api/me','GET',undefined,cookie(learner.session))).data.user,null);
 assert.equal((await signIn(env,'NORTH001','STU001','student')).status,401);
 const newLogin=await signIn(env,'NORTH001','NEWSTUDENT01','student');
 assert.equal(newLogin.status,200);
 assert.equal(newLogin.data.user.className,'11');
 assert.equal(newLogin.data.user.section,'B');
 const listed=await req(env,'/api/students','GET',undefined,auth);
 assert.equal(listed.data.students.find(x=>x.id===student).className,'11');
});

test('admin can change only student name without forcing sign-out or password reset',async()=>{
 const {env,student}=setup();
 const adm=await signIn(env,'NORTH001','ADM001');
 const learner=await signIn(env,'NORTH001','STU001','student');
 const edited=await req(env,'/api/admin/accounts','POST',{
  action:'updateStudent',userId:student,name:'Name Updated',className:'10',section:'A',loginId:'STU001'
 },cookie(adm.session));
 assert.equal(edited.status,200);
 assert.equal(edited.data.signedOut,false);
 assert.equal(edited.data.passwordChanged,false);
 assert.equal((await req(env,'/api/me','GET',undefined,cookie(learner.session))).data.user.name,'Name Updated');
});

test('admin optionally sets new student password and revokes previous sessions',async()=>{
 const {env,student}=setup();
 const adm=await signIn(env,'NORTH001','ADM001');
 const learner=await signIn(env,'NORTH001','STU001','student');
 const edited=await req(env,'/api/admin/accounts','POST',{
  action:'updateStudent',userId:student,name:'Learner North',className:'10',section:'A',loginId:'STU001',newPassword:'newpass123'
 },cookie(adm.session));
 assert.equal(edited.status,200);
 assert.equal(edited.data.passwordChanged,true);
 assert.equal(edited.data.signedOut,true);
 assert.equal((await req(env,'/api/me','GET',undefined,cookie(learner.session))).data.user,null);
 assert.equal((await signIn(env,'NORTH001','STU001','student')).status,401);
 const login=await signIn(env,'NORTH001','STU001','student','newpass123');
 assert.equal(login.status,200);
 assert.equal(login.data.user.needsPasswordChange,false);
});

test('student edit validates school, role, ID conflicts and required fields',async()=>{
 const {env,sqlite,student,other,teacher}=setup();
 const admin=await signIn(env,'NORTH001','ADM001');
 const staff=await signIn(env,'NORTH001','TCH001');
 const pupil=await signIn(env,'NORTH001','STU001','student');
 const changes={action:'updateStudent',userId:student,name:'Valid Name',className:'12',section:'C',loginId:'STU003'};
 assert.equal((await req(env,'/api/admin/accounts','POST',changes,cookie(staff.session))).status,403);
 assert.equal((await req(env,'/api/admin/accounts','POST',changes,cookie(pupil.session))).status,403);
 assert.equal((await req(env,'/api/admin/accounts','POST',{...changes,userId:other},cookie(admin.session))).status,404);
 assert.equal((await req(env,'/api/admin/accounts','POST',{...changes,userId:teacher},cookie(admin.session))).status,403);
 for(const invalid of [{className:''},{section:''},{loginId:'x'},{name:'a'},{newPassword:'12345'}, {loginId:'TCH001'}]){
  const r=await req(env,'/api/admin/accounts','POST',{...changes,...invalid},cookie(admin.session));
  assert.equal(r.status,invalid.loginId==='TCH001'?409:400,JSON.stringify({invalid,r}));
 }
 assert.equal(sqlite.prepare('SELECT class_name,section,login_id FROM users WHERE id=?').get(student).login_id,'STU001');
});
