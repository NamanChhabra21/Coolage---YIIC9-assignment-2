// Coolage Worker API — Cloudflare Workers + D1.
// Same-origin requests use HttpOnly cookies. Approved cross-origin frontend uses short-lived bearer session tokens.
// School data is scoped server-side.
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const ITERATIONS = 100000; // Cloudflare WebCrypto PBKDF2 hard limit; review CPU usage before production.
const te = new TextEncoder();

const now = () => Date.now();
const id = () => crypto.randomUUID();
const clean = (value, max = 140) => String(value ?? '').trim().slice(0, max);
const code = (value) => clean(value, 24).toUpperCase();
const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : null;
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers }
  });
}
const fail = (message, status = 400) => json({ error: message },status);
function hex(bytes) {return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2,'0')).join('');}
function bytes(hexString) {return Uint8Array.from(hexString.match(/.{2}/g) || [], x => parseInt(x,16));}
function randomHex(n) {return hex(crypto.getRandomValues(new Uint8Array(n)));}
// Readable one-time credentials: 10 random unambiguous characters in two groups.
// Passwords remain randomly generated; school administrators can choose their own.
function randomPassword() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const result=[];
  while(result.length<10){
    const arr=crypto.getRandomValues(new Uint8Array(10));
    for(const n of arr){if(n<224)result.push(alphabet[n % alphabet.length]);if(result.length===10)break;}
  }
  return result.slice(0,5).join('')+'-'+result.slice(5).join('');
}
async function chooseLoginId(db,schoolId,role,requested) {
  if(requested!==undefined && requested!==null && String(requested).trim()){
    const next=String(requested).trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9._-]{3,23}$/.test(next))return null;
    return next;
  }
  const prefix=role==='student'?'STU':'TCH';
  for(let attempt=0;attempt<24;attempt++){
    const candidate=prefix+String(10000+(crypto.getRandomValues(new Uint32Array(1))[0]%90000));
    const exists=await db.prepare('SELECT 1 FROM users WHERE school_id=? AND login_id=? LIMIT 1').bind(schoolId,candidate).first();
    if(!exists)return candidate;
  }
  throw new Error('Unable to create a unique login ID.');
}
async function digest(value) {return hex(await crypto.subtle.digest('SHA-256',te.encode(value)));}
async function passwordHash(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveBits']);
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations},key,256));
}
function equalHex(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch=0; for(let i=0;i<a.length;i++) mismatch |= a.charCodeAt(i)^b.charCodeAt(i);
  return mismatch===0;
}
function sessionCookie(request, value, maxAge) {
  const isHttps = new URL(request.url).protocol === 'https:';
  return `oc_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps?'; Secure':''}`;
}
async function body(request) {
  const length = Number(request.headers.get('content-length') || '0');
  if (length > 16384) throw new Error('Request too large.');
  const raw = await request.text();
  if (raw.length > 16384) throw new Error('Request too large.');
  try {return JSON.parse(raw);} catch {throw new Error('Invalid JSON.');}
}
function currentToken(request, external = false) {
  if (external) {
    const match = (request.headers.get('authorization') || '').match(/^Bearer ([a-f0-9]{64})$/i);
    return match?.[1] || null;
  }
  const match = (request.headers.get('cookie') || '').match(/(?:^|;\s*)oc_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] || null;
}
async function currentUser(db, request, external = false) {
  const token = currentToken(request, external);
  if (!token) return null;
  const hash = await digest(token);
  return await db.prepare(`SELECT u.id,u.school_id,u.login_id,u.role,u.name,u.class_name,u.section,
          u.needs_password_change,s.code AS school_code,s.name AS school_name
          FROM sessions ss JOIN users u ON u.id=ss.user_id JOIN schools s ON s.id=u.school_id
          WHERE ss.token_hash=? AND ss.expires_at>?`).bind(hash,now()).first();
}
const profile = (u) => ({id:u.id,schoolCode:u.school_code,schoolName:u.school_name,loginId:u.login_id,
  role:u.role,name:u.name,className:u.class_name,section:u.section,needsPasswordChange:!!u.needs_password_change});
function staffGuard(u) {return u.role==='staff'||u.role==='admin';}
async function assigned(db,u,className,section) {
  if(u.role==='admin') return true;
  if(u.role!=='staff') return false;
  return !!await db.prepare('SELECT 1 FROM staff_classes WHERE school_id=? AND staff_id=? AND class_name=? AND section=?')
    .bind(u.school_id,u.id,className,section).first();
}
async function login(db,request,external = false,env) {
  const p=await body(request);
  const schoolCode=code(p.schoolCode), loginId=code(p.loginId);
  const requestedRole=p.role==='student'?'student':p.role==='staff'?'staff':null;
  if(!requestedRole || !schoolCode || !loginId || !p.password || String(p.password).length>200) return fail('Invalid credentials.',401);
  const u=await db.prepare(`SELECT u.*,s.code AS school_code,s.name AS school_name
       FROM users u JOIN schools s ON s.id=u.school_id
       WHERE s.code=? AND u.login_id=?`).bind(schoolCode,loginId).first();
  if(!u || (requestedRole==='student') !== (u.role==='student')) return fail('Invalid credentials.',401);
  if(u.locked_until>now()) return fail('Account temporarily locked. Try again later.',429);
  const attempt=await passwordHash(String(p.password),u.salt,u.iterations);
  if(!equalHex(attempt,u.password_hash)) {
    const count=(u.failed_logins || 0)+1;
    await db.prepare('UPDATE users SET failed_logins=?,locked_until=? WHERE id=?')
      .bind(count>=5?0:count,count>=5?now()+15*60*1000:0,u.id).run();
    return fail('Invalid credentials.',401);
  }
  await db.prepare('UPDATE users SET failed_logins=0,locked_until=0 WHERE id=?').bind(u.id).run();
  const token=randomHex(32);
  await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
     .bind(await digest(token),u.id,now()+SESSION_MAX_AGE*1000,now()).run();
  return external ? json({user:profile(u),sessionToken:token},200)
    : json({user:profile(u)},200,{'set-cookie':sessionCookie(request,token,SESSION_MAX_AGE)});
}
async function logout(db,request,external = false) {
  const token=currentToken(request,external);
  if(token) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
  return external ? json({ok:true},200) : json({ok:true},200,{'set-cookie':sessionCookie(request,'',0)});
}
async function changePassword(db,request,u,external = false) {
  const p=await body(request);
  const newPassword=String(p.newPassword||'');
  if(newPassword.length<6||newPassword.length>128) return fail('Use a password with 6–128 characters.');
  const record=await db.prepare('SELECT salt,password_hash,iterations FROM users WHERE id=?').bind(u.id).first();
  if(!p.oldPassword || !equalHex(await passwordHash(String(p.oldPassword),record.salt,record.iterations),record.password_hash))
    return fail('Current password is incorrect.',403);
  const salt=randomHex(16), hash=await passwordHash(newPassword,salt);
  await db.prepare('UPDATE users SET salt=?,password_hash=?,iterations=?,needs_password_change=0,failed_logins=0,locked_until=0 WHERE id=?')
    .bind(salt,hash,ITERATIONS,u.id).run();
  await db.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();
  return external ? json({ok:true,message:'Password changed. Sign in again.'},200)
    : json({ok:true,message:'Password changed. Sign in again.'},200,{'set-cookie':sessionCookie(request,'',0)});
}
async function createUser(db,u,p,role) {
  const name=clean(p.name,90),className=clean(p.className,12),section=clean(p.section,8).toUpperCase();
  if(name.length<2) return fail('Enter a name with at least 2 characters.');
  if(role==='student' && (!className || !section)) return fail('Class and section are required.');
  if(role==='student' && !await assigned(db,u,className,section)) return fail('You can only add students to your assigned classes.',403);
  if(role==='staff' && (className&&!section || section&&!className)) return fail('Enter both class and section, or leave both blank.');
  if(p.loginId!==undefined && typeof p.loginId!=='string')return fail('Invalid login ID.');
  const loginId=await chooseLoginId(db,u.school_id,role,p.loginId);
  if(!loginId)return fail('Login ID must be 4–24 characters, start with a letter, and use letters, numbers, periods, underscores, or hyphens.');
  if(p.password!==undefined && typeof p.password!=='string')return fail('Invalid password.');
  const password=p.password||randomPassword();
  if(password.length<6||password.length>128)return fail('Password must be 6–128 characters.');
  const salt=randomHex(16), hash=await passwordHash(password,salt), userId=id();
  const stamp=now();
  await db.prepare(`INSERT INTO users (id,school_id,login_id,role,name,class_name,section,salt,password_hash,iterations,needs_password_change,created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`)
        .bind(userId,u.school_id,loginId,role,name,role==='student'?className:'',role==='student'?section:'',salt,hash,ITERATIONS,stamp).run();
  if(role==='staff' && className && section) await db.prepare('INSERT INTO staff_classes(staff_id,school_id,class_name,section) VALUES(?,?,?,?)')
       .bind(userId,u.school_id,className,section).run();
  return json({user:{id:userId,loginId,name,role,className,section},temporaryPassword:password,
    note:'Share privately. This password is shown only once. Users may change it later in Settings.'},201);
}
// School administrators can update teacher/student sign-in IDs or reset their passwords.
// Existing passwords are never shown or retrievable. Both edits revoke active sessions.
async function manageAccount(db,request,u) {
  if(u.role!=='admin')return fail('Only a school administrator can manage account credentials.',403);
  const p=await body(request);
  const userId=clean(p.userId,80);
  if(!/^[0-9a-f-]{36}$/i.test(userId))return fail('Invalid account ID.');
  const target=await db.prepare(`SELECT id,login_id AS loginId,role,name FROM users
    WHERE id=? AND school_id=? AND role IN ('student','staff')`)
    .bind(userId,u.school_id).first();
  if(!target)return fail('Teacher or student account not found in your school.',404);

  // Edit a student's profile and login in one transaction. Attendance history is
  // retained if the student changes class or section; sessions are revoked when
  // their class/section or credentials change so the next login loads fresh data.
  if(p.action==='updateStudent') {
    if(target.role!=='student')return fail('Only student accounts can be edited using this action.',403);
    if(typeof p.name!=='string'||typeof p.className!=='string'||typeof p.section!=='string'||typeof p.loginId!=='string')
      return fail('Name, class, section, and login ID are required.');
    const name=p.name.trim();
    const className=p.className.trim();
    const section=p.section.trim().toUpperCase();
    const loginId=p.loginId.trim().toUpperCase();
    if(name.length<2||name.length>90)return fail('Name must contain 2–90 characters.');
    if(!className||className.length>12||!section||section.length>8)
      return fail('Class and section are required and must be 12 and 8 characters or fewer.');
    if(!/^[A-Z][A-Z0-9._-]{3,23}$/.test(loginId))
      return fail('Login ID must be 4–24 characters, start with a letter, and use only letters, numbers, periods, underscores, or hyphens.');
    if(p.newPassword!==undefined && typeof p.newPassword!=='string')return fail('Invalid password.');
    const password=p.newPassword||'';
    if(password && (password.length<6||password.length>128))return fail('New password must contain 6–128 characters.');
    const current=await db.prepare(`SELECT login_id,class_name,section FROM users
      WHERE id=? AND school_id=? AND role='student'`).bind(userId,u.school_id).first();
    if(!current)return fail('Student account not found.',404);
    const signedOut=!!password||loginId!==current.login_id.toUpperCase()||
      className!==current.class_name||section!==current.section;
    const updates=[];
    if(password){
      const salt=randomHex(16),hash=await passwordHash(password,salt);
      updates.push(db.prepare(`UPDATE users SET name=?,class_name=?,section=?,login_id=?,
        salt=?,password_hash=?,iterations=?,needs_password_change=0,failed_logins=0,locked_until=0
        WHERE id=? AND school_id=? AND role='student'`)
        .bind(name,className,section,loginId,salt,hash,ITERATIONS,userId,u.school_id));
    }else{
      updates.push(db.prepare(`UPDATE users SET name=?,class_name=?,section=?,login_id=?
        WHERE id=? AND school_id=? AND role='student'`)
        .bind(name,className,section,loginId,userId,u.school_id));
    }
    if(signedOut)updates.push(db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId));
    await db.batch(updates);
    return json({ok:true,student:{id:userId,name,className,section,loginId},
      signedOut,passwordChanged:!!password,message:'Student details updated.'});
  }

  if(p.action==='updateName') {
    if(typeof p.name!=='string')return fail('Enter a name.');
    const name=p.name.trim();
    if(name.length<2 || name.length>90)return fail('Name must contain 2–90 characters.');
    await db.prepare(`UPDATE users SET name=? WHERE id=? AND school_id=? AND role IN ('student','staff')`)
      .bind(name,userId,u.school_id).run();
    return json({ok:true,name,message:'Name updated.'});
  }
  if(p.action==='deleteAccount') {
    if(p.confirm!=='DELETE')return fail('Type DELETE to confirm account deletion.');
    // Dependents have restrictive foreign keys; remove only data related to this
    // student or teacher, within the admin's own school, in one transaction.
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId),
      db.prepare('DELETE FROM attendance WHERE school_id=? AND (student_id=? OR marked_by=?)').bind(u.school_id,userId,userId),
      db.prepare('DELETE FROM homework WHERE school_id=? AND created_by=?').bind(u.school_id,userId),
      db.prepare('DELETE FROM announcements WHERE school_id=? AND created_by=?').bind(u.school_id,userId),
      db.prepare('DELETE FROM staff_classes WHERE school_id=? AND staff_id=?').bind(u.school_id,userId),
      db.prepare(`DELETE FROM users WHERE id=? AND school_id=? AND role IN ('student','staff')`).bind(userId,u.school_id)
    ]);
    return json({ok:true,message:'Account and directly related records deleted.'});
  }

  if(p.action==='updateLoginId') {
    if(typeof p.loginId!=='string')return fail('Enter a login ID.');
    const next=p.loginId.trim().toUpperCase();
    if(!/^[A-Z][A-Z0-9._-]{3,23}$/.test(next))
      return fail('Login ID must be 4–24 characters, start with a letter, and use only letters, numbers, periods, underscores, or hyphens.');
    if(next===target.loginId.toUpperCase())return json({ok:true,loginId:target.loginId,message:'Login ID is unchanged.'});
    // UNIQUE(school_id, login_id) is the final case-insensitive collision guard.
    await db.batch([
      db.prepare(`UPDATE users SET login_id=?,failed_logins=0,locked_until=0
        WHERE id=? AND school_id=? AND role IN ('student','staff')`).bind(next,userId,u.school_id),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId)
    ]);
    return json({ok:true,loginId:next,message:'Login ID updated. The account must sign in again.'});
  }

  if(p.action==='resetPassword') {
    if(p.newPassword!==undefined && typeof p.newPassword!=='string')return fail('Invalid new password.');
    const password=p.newPassword || randomPassword();
    if(password.length<6||password.length>128)return fail('Temporary password must contain 6–128 characters.');
    const salt=randomHex(16),hash=await passwordHash(password,salt);
    await db.batch([
      db.prepare(`UPDATE users SET salt=?,password_hash=?,iterations=?,needs_password_change=0,
        failed_logins=0,locked_until=0 WHERE id=? AND school_id=? AND role IN ('student','staff')`)
        .bind(salt,hash,ITERATIONS,userId,u.school_id),
      db.prepare('DELETE FROM sessions WHERE user_id=?').bind(userId)
    ]);
    return json({ok:true,loginId:target.loginId,temporaryPassword:password,
      message:'Password reset. All existing sessions were signed out. The user can change this password later in Settings.'});
  }
  return fail('Unknown account management action.');
}
async function getStudents(db,u) {
  if(u.role==='student') return fail('Forbidden.',403);
  const q=u.role==='admin'
    ?db.prepare(`SELECT id,login_id AS loginId,name,class_name AS className,section,created_at AS createdAt FROM users WHERE school_id=? AND role='student' ORDER BY name LIMIT 200`).bind(u.school_id)
    :db.prepare(`SELECT u.id,u.login_id AS loginId,u.name,u.class_name AS className,u.section,u.created_at AS createdAt
        FROM users u WHERE u.school_id=? AND u.role='student' AND EXISTS
        (SELECT 1 FROM staff_classes sc WHERE sc.staff_id=? AND sc.school_id=u.school_id AND sc.class_name=u.class_name AND sc.section=u.section)
        ORDER BY u.name LIMIT 200`).bind(u.school_id,u.id);
  return json({students:(await q.all()).results});
}
async function getStaff(db,u) {
  if(u.role!=='admin') return fail('Forbidden.',403);
  const staff=(await db.prepare(`SELECT id,login_id AS loginId,name,created_at AS createdAt FROM users
    WHERE school_id=? AND role='staff' ORDER BY name LIMIT 100`).bind(u.school_id).all()).results;
  const classes=(await db.prepare(`SELECT sc.staff_id AS staffId, sc.class_name AS className, sc.section
    FROM staff_classes sc WHERE sc.school_id=? ORDER BY class_name,section`).bind(u.school_id).all()).results;
  return json({staff:staff.map(s=>({...s,classes:classes.filter(c=>c.staffId===s.id)}))});
}
async function getClasses(db,u) {
  if(u.role==='student') return json({classes:[{className:u.class_name,section:u.section}]});
  if(u.role==='admin') {
    const cls=(await db.prepare(`SELECT DISTINCT class_name AS className,section FROM (
      SELECT class_name,section FROM users WHERE school_id=? AND role='student' UNION
      SELECT class_name,section FROM staff_classes WHERE school_id=?) ORDER BY class_name,section`)
      .bind(u.school_id,u.school_id).all()).results;
    return json({classes:cls});
  }
  return json({classes:(await db.prepare('SELECT class_name AS className,section FROM staff_classes WHERE school_id=? AND staff_id=? ORDER BY class_name,section')
    .bind(u.school_id,u.id).all()).results});
}
async function getHomework(db,u) {
  let q;
  if(u.role==='student') q=db.prepare(`SELECT h.id,h.title,h.details,h.subject,h.due_date AS dueDate,h.class_name AS className,h.section,h.created_at AS createdAt,
      x.name AS author FROM homework h JOIN users x ON x.id=h.created_by WHERE h.school_id=? AND h.class_name=? AND h.section=? ORDER BY h.created_at DESC LIMIT 80`)
    .bind(u.school_id,u.class_name,u.section);
  else if(u.role==='admin') q=db.prepare(`SELECT h.id,h.title,h.details,h.subject,h.due_date AS dueDate,h.class_name AS className,h.section,h.created_at AS createdAt,
      x.name AS author FROM homework h JOIN users x ON x.id=h.created_by WHERE h.school_id=? ORDER BY h.created_at DESC LIMIT 100`).bind(u.school_id);
  else q=db.prepare(`SELECT h.id,h.title,h.details,h.subject,h.due_date AS dueDate,h.class_name AS className,h.section,h.created_at AS createdAt,
      x.name AS author FROM homework h JOIN users x ON x.id=h.created_by WHERE h.school_id=?
      AND EXISTS(SELECT 1 FROM staff_classes sc WHERE sc.school_id=h.school_id AND sc.staff_id=? AND sc.class_name=h.class_name AND sc.section=h.section)
      ORDER BY h.created_at DESC LIMIT 100`).bind(u.school_id,u.id);
  return json({homework:(await q.all()).results});
}
async function createHomework(db,request,u) {
  if(!staffGuard(u))return fail('Forbidden.',403);
  const p=await body(request),className=clean(p.className,12),section=clean(p.section,8).toUpperCase(),
    subject=clean(p.subject,60),title=clean(p.title,120),details=clean(p.details,1500),dueDate=safeDate(p.dueDate);
  if(!className||!section||!dueDate||subject.length<2||title.length<3)return fail('Class, section, subject, title and due date are required.');
  if(!await assigned(db,u,className,section))return fail('Class not assigned to you.',403);
  await db.prepare('INSERT INTO homework(id,school_id,class_name,section,subject,title,details,due_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(id(),u.school_id,className,section,subject,title,details,dueDate,u.id,now()).run();
  return json({ok:true},201);
}
async function getAnnouncements(db,u) {
  let q;
  if(u.role==='student') q=db.prepare(`SELECT a.id,a.title,a.body,a.class_name AS className,a.section,a.created_at AS createdAt,x.name AS author
     FROM announcements a JOIN users x ON x.id=a.created_by WHERE a.school_id=? AND
     ((a.class_name='' AND a.section='') OR (a.class_name=? AND a.section=?)) ORDER BY a.created_at DESC LIMIT 80`)
    .bind(u.school_id,u.class_name,u.section);
  else if(u.role==='admin') q=db.prepare(`SELECT a.id,a.title,a.body,a.class_name AS className,a.section,a.created_at AS createdAt,x.name AS author
     FROM announcements a JOIN users x ON x.id=a.created_by WHERE a.school_id=? ORDER BY a.created_at DESC LIMIT 100`).bind(u.school_id);
  else q=db.prepare(`SELECT a.id,a.title,a.body,a.class_name AS className,a.section,a.created_at AS createdAt,x.name AS author
     FROM announcements a JOIN users x ON x.id=a.created_by WHERE a.school_id=? AND
     ((a.class_name='' AND a.section='') OR EXISTS(SELECT 1 FROM staff_classes sc WHERE sc.school_id=a.school_id AND sc.staff_id=?
        AND sc.class_name=a.class_name AND sc.section=a.section)) ORDER BY a.created_at DESC LIMIT 80`).bind(u.school_id,u.id);
  return json({announcements:(await q.all()).results});
}
async function createAnnouncement(db,request,u) {
  if(!staffGuard(u)) return fail('Forbidden.',403);
  const p=await body(request),title=clean(p.title,120),message=clean(p.body,1600),
    className=clean(p.className,12),section=clean(p.section,8).toUpperCase();
  if(title.length<3||message.length<3)return fail('Title and message are required.');
  if(!!className!==!!section)return fail('Specify both class and section or neither.');
  if(u.role==='staff'&&!className)return fail('Teachers must select an assigned class.',403);
  if(className&&!await assigned(db,u,className,section))return fail('Class not assigned to you.',403);
  await db.prepare('INSERT INTO announcements(id,school_id,class_name,section,title,body,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id(),u.school_id,className,section,title,message,u.id,now()).run();
  return json({ok:true},201);
}
async function getAttendance(db,u,request) {
  const date=safeDate(new URL(request.url).searchParams.get('date'));
  if(u.role==='student'){
    const [rows,summary]=await Promise.all([
      db.prepare(`SELECT date,status FROM attendance WHERE school_id=? AND student_id=? ORDER BY date DESC LIMIT 2000`).bind(u.school_id,u.id).all(),
      db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN status='present' THEN 1 ELSE 0 END),0) AS present,COALESCE(SUM(CASE WHEN status='absent' THEN 1 ELSE 0 END),0) AS absent FROM attendance WHERE school_id=? AND student_id=?`).bind(u.school_id,u.id).first()
    ]);
    return json({attendance:rows.results,summary});
  }
  if(!date)return fail('Choose a date (YYYY-MM-DD).');
  let q;
  if(u.role==='admin')q=db.prepare(`SELECT a.student_id AS studentId,a.date,a.status FROM attendance a JOIN users s ON s.id=a.student_id
    WHERE a.school_id=? AND a.date=?`).bind(u.school_id,date);
  else q=db.prepare(`SELECT a.student_id AS studentId,a.date,a.status FROM attendance a JOIN users s ON s.id=a.student_id
    WHERE a.school_id=? AND a.date=? AND EXISTS(SELECT 1 FROM staff_classes sc WHERE sc.school_id=s.school_id AND sc.staff_id=?
    AND sc.class_name=s.class_name AND sc.section=s.section)`).bind(u.school_id,date,u.id);
  return json({attendance:(await q.all()).results});
}
async function markAttendance(db,request,u) {
  if(!staffGuard(u))return fail('Forbidden.',403);
  const p=await body(request),date=safeDate(p.date);
  if(!date||!['present','absent'].includes(p.status))return fail('Invalid date or status.');
  const student=await db.prepare(`SELECT id,class_name,section FROM users WHERE id=? AND school_id=? AND role='student'`)
    .bind(clean(p.studentId,80),u.school_id).first();
  if(!student)return fail('Student not found.',404);
  if(!await assigned(db,u,student.class_name,student.section))return fail('Class not assigned to you.',403);
  await db.prepare(`INSERT INTO attendance(school_id,student_id,date,status,marked_by,marked_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(student_id,date) DO UPDATE SET status=excluded.status,marked_by=excluded.marked_by,marked_at=excluded.marked_at`)
    .bind(u.school_id,student.id,date,p.status,u.id,now()).run();
  return json({ok:true});
}
async function registerSchool(db,request,external = false) {
  const p=await body(request);
  const name=clean(p.name,100), city=clean(p.city,80), ownerName=clean(p.ownerName,90);
  const email=clean(p.ownerEmail,160).toLowerCase();
  const password=String(p.password||'');
  if(name.length<3 || ownerName.length<2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return fail('Enter a school name, owner name, and valid email.');
  if(password.length<6 || password.length>128 || password!==String(p.confirmPassword||''))
    return fail('Passwords must match and contain 6–128 characters.');
  // A basic duplicate/abuse guard; add managed bot protection and email verification before public launch.
  const recent=await db.prepare('SELECT id FROM school_requests WHERE owner_email=? AND created_at>? LIMIT 1')
    .bind(email,now()-60*60*1000).first();
  if(recent) return fail('A school registration was recently submitted using this email. Try again later.',429);
  const schoolId=id(), adminId=id(), requestId=id(), stamp=now();
  const schoolCode='SCH'+randomHex(5).toUpperCase();
  const loginId='ADM'+randomHex(4).toUpperCase();
  const salt=randomHex(16), hash=await passwordHash(password,salt);
  const token=randomHex(32), tokenHash=await digest(token);
  // D1 batch runs as a transaction: school, admin, and first session must
  // either all be created or all roll back.
  await db.batch([
    db.prepare('INSERT INTO schools(id,code,name,city,created_at) VALUES(?,?,?,?,?)')
      .bind(schoolId,schoolCode,name,city,stamp),
    db.prepare(`INSERT INTO users(id,school_id,login_id,role,name,class_name,section,salt,password_hash,iterations,needs_password_change,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`)
      .bind(adminId,schoolId,loginId,'admin',ownerName,'','',salt,hash,ITERATIONS,stamp),
    db.prepare(`INSERT INTO school_requests(id,name,city,owner_name,owner_email,status,created_at)
      VALUES(?,?,?,?,?,'approved',?)`).bind(requestId,name,city,ownerName,email,stamp),
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(tokenHash,adminId,stamp+SESSION_MAX_AGE*1000,stamp)
  ]);
  const user=profile({id:adminId,school_code:schoolCode,school_name:name,login_id:loginId,
    role:'admin',name:ownerName,class_name:'',section:'',needs_password_change:0});
  const result={ok:true,message:'School created. You are signed in.',schoolCode,loginId,user};
  return external ? json({...result,sessionToken:token},201)
    : json(result,201,{'set-cookie':sessionCookie(request,token,SESSION_MAX_AGE)});
}
async function requestSchool(db,request) {
  const p=await body(request),name=clean(p.name,100),city=clean(p.city,80),
    ownerName=clean(p.ownerName,90),email=clean(p.ownerEmail,160).toLowerCase();
  if(name.length<3||ownerName.length<2||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('Enter a school name, contact name and valid email.');
  const requestKey=clean(p.requestKey,60);
  if(requestKey && !/^[a-f0-9-]{36}$/i.test(requestKey))return fail('Invalid request identifier.');
  const accepted='Request received. A platform administrator must verify school ownership before approval.';
  // A retry can arrive after the database committed but before the browser saw a response.
  // A unique key makes it safe to re-send the same request.
  await db.prepare(`INSERT INTO school_requests(id,name,city,owner_name,owner_email,request_key,created_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING`)
    .bind(id(),name,city,ownerName,email,requestKey||null,now()).run();
  if(requestKey){
    const record=await db.prepare('SELECT name,owner_email FROM school_requests WHERE request_key=?').bind(requestKey).first();
    if(record?.name!==name || record?.owner_email!==email)return fail('This request was already submitted with different details. Please submit again.',409);
  }
  return json({ok:true,message:accepted},201);
}
// Configure exactly one trusted HTTPS frontend origin (no trailing slash) to use
// InfinityFree + Workers separately. Never reflect arbitrary Origin headers.
function allowedFrontend(env) {
  const value=String(env.FRONTEND_ORIGIN || '').trim().replace(/\/$/,'');
  try {
    const u=new URL(value);
    if(u.origin!==value || (u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname))))return '';
    return u.origin;
  } catch {return '';}
}
function withCors(response,origin) {
  const headers=new Headers(response.headers);
  headers.set('access-control-allow-origin',origin);
  headers.set('access-control-allow-methods','GET, POST, OPTIONS');
  headers.set('access-control-allow-headers','Content-Type, Authorization');
  headers.set('access-control-max-age','600');
  headers.append('vary','Origin');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
async function handleApi(request,env,external) {
  const url=new URL(request.url);
    try {
      if(!['GET','POST'].includes(request.method))return fail('Method not allowed.',405);
      if(request.method!=='GET') {
        const origin=request.headers.get('origin');
        if(origin && origin!==url.origin && !external)return fail('Cross-origin requests not allowed.',403);
        if(request.headers.get('sec-fetch-site')==='cross-site' && !external)return fail('Cross-site requests not allowed.',403);
        if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return fail('Expected JSON request.',415);
      }
      if(url.pathname==='/api/health' && request.method==='GET') {
        let databaseConfigured=false;
        if(env.DB){try{await env.DB.prepare('SELECT id FROM schools LIMIT 1').first();databaseConfigured=true}catch{}}
        return json({ok:true,app:'Coolage',mode:'cloudflare-d1',databaseConfigured});
      }
      if(!env.DB)return fail('D1 database not configured.',503);
      if(url.pathname==='/api/schools/register' && request.method==='POST')return await registerSchool(env.DB,request,external);
      if(url.pathname==='/api/school-requests' && request.method==='POST')return await requestSchool(env.DB,request);
      if(url.pathname==='/api/auth/login' && request.method==='POST')return await login(env.DB,request,external,env);
      if(url.pathname==='/api/auth/logout' && request.method==='POST')return await logout(env.DB,request,external);
      const u=await currentUser(env.DB,request,external);
      if(url.pathname==='/api/me' && request.method==='GET')return json({user:u?profile(u):null});
      if(!u)return fail('Please sign in.',401);
      if(url.pathname==='/api/auth/password' && request.method==='POST')return await changePassword(env.DB,request,u,external);
      const action=request.method+' '+url.pathname;
      switch(action) {
        case 'GET /api/classes':return await getClasses(env.DB,u);
        case 'GET /api/students':return await getStudents(env.DB,u);
        case 'POST /api/students':return staffGuard(u)?await createUser(env.DB,u,await body(request),'student'):fail('Forbidden.',403);
        case 'POST /api/admin/accounts':return await manageAccount(env.DB,request,u);
        case 'GET /api/staff':return await getStaff(env.DB,u);
        case 'POST /api/staff':return u.role==='admin'?await createUser(env.DB,u,await body(request),'staff'):fail('Forbidden.',403);
        case 'GET /api/homework':return await getHomework(env.DB,u);
        case 'POST /api/homework':return await createHomework(env.DB,request,u);
        case 'GET /api/announcements':return await getAnnouncements(env.DB,u);
        case 'POST /api/announcements':return await createAnnouncement(env.DB,request,u);
        case 'GET /api/attendance':return await getAttendance(env.DB,u,request);
        case 'POST /api/attendance':return await markAttendance(env.DB,request,u);
        default:return fail('Not found.',404);
      }
    } catch(err) {
      if(err?.message==='Request too large.'||err?.message==='Invalid JSON.')return fail(err.message,400);
      if(String(err?.message||'').includes('UNIQUE constraint failed'))return fail('That account or record already exists.',409);
      console.error('Coolage API error',err);
      return fail('An unexpected server error occurred.',500);
    }
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin=request.headers.get('origin');
    const external=!!origin && origin!==url.origin && origin===allowedFrontend(env);
    // Even for public endpoints, do not accept arbitrary cross-site origins.
    if(origin && origin!==url.origin && !external)return fail('Frontend origin not allowed.',403);
    if(request.method==='OPTIONS') {
      if(!external)return fail('Method not allowed.',405);
      const requested=(request.headers.get('access-control-request-method')||'').toUpperCase();
      if(!['GET','POST'].includes(requested))return withCors(fail('Method not allowed.',405),origin);
      return withCors(new Response(null,{status:204}),origin);
    }
    const response=await handleApi(request,env,external);
    return external?withCors(response,origin):response;
  }
};
