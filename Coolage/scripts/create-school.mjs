import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [schoolName, schoolCode, ownerName, ownerId = 'ADM001', city = ''] = process.argv.slice(2);
if (![schoolName, schoolCode, ownerName].every(Boolean) || !/^[A-Z0-9-]{4,18}$/i.test(schoolCode) || !/^[A-Z0-9-]{4,18}$/i.test(ownerId)) {
  console.error('Usage: npm run seed:school -- "School Name" SCH001 "Owner Name" ADM001 "City"');
  process.exit(1);
}
const escapeSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const password = randomBytes(16).toString('base64url');
const salt = randomBytes(16).toString('hex');
const iterations = 100000;
const hash = pbkdf2Sync(password, Buffer.from(salt,'hex'), iterations, 32, 'sha256').toString('hex');
const schoolId = randomUUID();
const userId = randomUUID();
const now = Date.now();
const sql = `-- Apply ONLY after verifying that this is a legitimate school owner.\nINSERT INTO schools (id,code,name,city,created_at) VALUES (${escapeSql(schoolId)}, ${escapeSql(schoolCode.toUpperCase())}, ${escapeSql(schoolName)}, ${escapeSql(city)}, ${now});\nINSERT INTO users (id,school_id,login_id,role,name,salt,password_hash,iterations,needs_password_change,created_at) VALUES (${escapeSql(userId)},${escapeSql(schoolId)},${escapeSql(ownerId.toUpperCase())},'admin',${escapeSql(ownerName)},${escapeSql(salt)},${escapeSql(hash)},${iterations},1,${now});\n`;
writeFileSync('school-onboarding.sql',sql,{mode:0o600});
console.log('\nSchool code:',schoolCode.toUpperCase());
console.log('Owner login ID:',ownerId.toUpperCase());
console.log('Temporary password (share privately; shown only now):',password);
console.log('\nSQL written to school-onboarding.sql — apply locally or remotely with Wrangler after approval.');
