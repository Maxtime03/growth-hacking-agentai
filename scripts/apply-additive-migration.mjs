import fs from "node:fs/promises";
import path from "node:path";

const migration=process.argv[2];const apply=process.argv.includes("--apply");
if(!migration)throw new Error("Migration path required.");
const env=Object.fromEntries((await fs.readFile(path.resolve(".env.local"),"utf8")).split(/\r?\n/).filter(line=>line&&!line.startsWith("#")&&line.includes("=")).map(line=>{const index=line.indexOf("=");return[line.slice(0,index),line.slice(index+1).replace(/^['\"]|['\"]$/g,"")]}));
const token=env.SUPABASE_TOKEN_SECRET||env.SUPABASE_ACCESS_TOKEN;const ref=env.SUPABASE_PROJECT_REF||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];if(!token||!ref)throw new Error("Supabase management credentials unavailable.");
const sql=await fs.readFile(path.resolve(migration),"utf8");const query=apply?sql:`begin;\n${sql}\nrollback;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({query})});
if(!response.ok){const message=await response.text();throw new Error(`Migration ${apply?"apply":"check"} failed (${response.status}): ${message.slice(0,600)}`);}
console.log(JSON.stringify({ok:true,mode:apply?"applied":"transaction-check",migration:path.basename(migration)}));
