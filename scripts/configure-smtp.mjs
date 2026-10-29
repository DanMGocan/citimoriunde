// Local operator helper. Accept SMTP configuration through stdin, never argv,
// and preserve unrelated credentials. This is not exposed through the website.
import {constants} from 'node:fs';
import {open,readFile,rename,unlink,chmod} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
const file=resolve('.env'),temporary=resolve(`.env.smtp-${randomBytes(12).toString('hex')}`);
// Environment parsers do not interpret JSON escaping. Choose a literal delimiter
// absent from the value, and reject unsupported quoting instead of corrupting a key.
function envLiteral(value){const quote=["'",'`','"'].find(candidate=>!value.includes(candidate)&&(candidate!=='"'||!/[\\][nr]/.test(value)));if(!quote)throw new Error('Unsupported quoting.');return quote+value+quote;}
let created=false;
try{
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8192)throw new Error('Oversized input.');if(input.includes('\n'))break;}
 const values=JSON.parse(input),allowed=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_REQUIRE_TLS','SMTP_USER','SMTP_PASSWORD','SMTP_FROM','MAIL_MODE'];
 if(!values||Array.isArray(values)||typeof values!=='object'||Object.keys(values).some(key=>!allowed.includes(key)))throw new Error('Unsupported setting.');
 // Changing SMTP credentials invalidates any earlier delivery attestation.
 values.SMTP_VERIFIED='false';allowed.push('SMTP_VERIFIED');
 for(const key of allowed)if(typeof values[key]!=='string'||/[\r\n\0]/.test(values[key])||!values[key])throw new Error('Missing setting.');
 if(!/^[a-z0-9.-]+$/i.test(values.SMTP_HOST)||values.SMTP_PORT!=='587'||values.SMTP_SECURE!=='false'||values.SMTP_REQUIRE_TLS!=='true'||values.MAIL_MODE!=='smtp'||!values.SMTP_FROM.includes('@'))throw new Error('Invalid settings.');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let original;
 try{if(!(await handle.stat()).isFile())throw new Error('Not a regular file.');original=await handle.readFile('utf8');}finally{await handle.close();}
 const remaining=new Set(allowed),lines=original.split('\n').map(line=>{const match=line.match(/^([A-Z][A-Z0-9_]*)=/);if(!match||!remaining.has(match[1]))return line;remaining.delete(match[1]);return `${match[1]}=${envLiteral(values[match[1]])}`;});
 // Refuse duplicate target keys rather than leave an ambiguous secret setting.
 for(const key of allowed)if(original.split('\n').filter(line=>line.startsWith(key+'=')).length>1)throw new Error('Duplicate setting.');
 for(const key of remaining)lines.push(`${key}=${envLiteral(values[key])}`);
 const output=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);created=true;
 try{await output.writeFile(lines.join('\n').replace(/\n*$/,'\n'));await output.sync();}finally{await output.close();}
 if(await readFile(file,'utf8')!==original)throw new Error('Concurrent edit detected.');
 await rename(temporary,file);created=false;await chmod(file,0o600);
 console.log('SMTP settings saved to protected .env; unrelated credentials preserved. No email sent.');
}catch{console.error('SMTP settings were not saved; values and exception details redacted.');process.exitCode=1;}
finally{if(created)await unlink(temporary).catch(()=>{});}
