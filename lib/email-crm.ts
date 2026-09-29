import type { ChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { decryptSecret } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";
import { classifyEmailReply } from "@/lib/email-rules";

export const GMAIL_SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

export type EmailAccount = {
  id:string; owner_email:string; email_address:string; display_name:string|null; scopes:string[];
  encrypted_refresh_token:string; status:string; token_expires_at:string|null; gmail_history_id:string|null;
  watch_expiration:string|null; last_sync_at:string|null; initial_sync_days:number;
};

type GmailPart={mimeType?:string;filename?:string;headers?:Array<{name:string;value:string}>;body?:{data?:string;attachmentId?:string;size?:number};parts?:GmailPart[]};
type GmailMessage={id:string;threadId:string;historyId?:string;labelIds?:string[];internalDate?:string;snippet?:string;payload?:GmailPart};

export async function requireEmailAccount(user:ChatGPTUser, accountId:string) {
  const response=await supabaseRest(`email_accounts?id=eq.${encodeURIComponent(accountId)}&owner_email=eq.${encodeURIComponent(user.email.toLowerCase())}&select=*&limit=1`);
  const rows=response.ok?await response.json() as EmailAccount[]:[];
  const account=rows[0]; if(!account) throw new Error("Compte Gmail non autorisé.");
  const allowed=await accountWorkspaceIds(user,account.id); if(!allowed.length) throw new Error("Aucun workspace autorisé pour ce compte.");
  return {account,workspaceIds:allowed};
}

export async function accountWorkspaceIds(user:ChatGPTUser,accountId:string){
  const response=await supabaseRest(`email_account_workspaces?account_id=eq.${encodeURIComponent(accountId)}&select=workspace_id,workspaces(slug)`);
  const rows=response.ok?await response.json() as Array<{workspace_id:string;workspaces:{slug:string}|null}>:[];
  return rows.filter(row=>row.workspaces&&canAccessWorkspace(user,normalizeWorkspace(row.workspaces.slug))).map(row=>row.workspace_id);
}

export async function googleAccessToken(account:EmailAccount){
  const clientId=process.env.GOOGLE_OAUTH_CLIENT_ID,clientSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if(!clientId||!clientSecret)throw new Error("Configuration OAuth Google incomplète.");
  const refreshToken=await decryptSecret(account.encrypted_refresh_token);
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"}),cache:"no-store"});
  const payload=await response.json() as {access_token?:string;error?:string};
  if(!response.ok||!payload.access_token){await supabaseRest(`email_accounts?id=eq.${account.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"expired",status_detail:"refresh_failed",updated_at:new Date().toISOString()})});throw new Error("Compte Gmail expiré. Reconnectez-le.");}
  return payload.access_token;
}

export async function gmail(token:string,path:string,init:RequestInit={}){
  return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`,{...init,headers:{Authorization:`Bearer ${token}`,"content-type":"application/json",...(init.headers||{})},cache:"no-store"});
}

export async function syncGmailAccount(user:ChatGPTUser,accountId:string,forceFull=false){
  const {account,workspaceIds}=await requireEmailAccount(user,accountId); const token=await googleAccessToken(account);
  const stateResponse=await supabaseRest(`email_sync_state?account_id=eq.${account.id}&select=*&limit=1`);
  const state=(stateResponse.ok?(await stateResponse.json() as Array<{history_id?:string;page_token?:string}>)[0]:null);
  let mode:"initial"|"incremental"=forceFull||!state?.history_id?"initial":"incremental"; let refs:Array<{id:string;threadId?:string}>=[]; let nextPageToken:string|undefined;
  if(mode==="incremental"){
    do {
      const page=nextPageToken?`&pageToken=${encodeURIComponent(nextPageToken)}`:"";
      const h=await gmail(token,`history?startHistoryId=${encodeURIComponent(state!.history_id!)}&historyTypes=messageAdded&labelId=INBOX&maxResults=100${page}`);
      if(h.status===404){mode="initial";refs=[];nextPageToken=undefined;break;}
      if(!h.ok)throw new Error(`Synchronisation Gmail history.list refusée (${h.status}).`);
      const data=await h.json() as {history?:Array<{messagesAdded?:Array<{message:{id:string;threadId?:string}}>}>;nextPageToken?:string};
      refs.push(...(data.history||[]).flatMap(x=>x.messagesAdded||[]).map(x=>x.message));
      nextPageToken=data.nextPageToken;
    } while(nextPageToken);
  }
  if(mode==="initial"){
    const days=Math.max(1,Math.min(365,account.initial_sync_days||30));
    do {
      const page=nextPageToken?`&pageToken=${encodeURIComponent(nextPageToken)}`:"";
      const listed=await gmail(token,`messages?maxResults=100&q=${encodeURIComponent(`newer_than:${days}d`)}${page}`);
      if(!listed.ok)throw new Error(`Première synchronisation Gmail refusée (${listed.status}).`);
      const data=await listed.json() as {messages?:Array<{id:string;threadId?:string}>;nextPageToken?:string};
      refs.push(...(data.messages||[]));
      nextPageToken=data.nextPageToken;
    } while(nextPageToken);
  }
  const unique=[...new Map(refs.map(item=>[item.id,item])).values()]; let stored=0;
  for(const ref of unique){const response=await gmail(token,`messages/${encodeURIComponent(ref.id)}?format=full`);if(!response.ok)throw new Error(`Lecture Gmail message refusée (${response.status}).`);await persistMessage(account,workspaceIds,await response.json() as GmailMessage);stored++;}
  const profile=await gmail(token,"profile");if(!profile.ok)throw new Error("Vérification users.getProfile impossible.");const profileData=await profile.json() as {historyId?:string;messagesTotal?:number};const now=new Date().toISOString();
  await supabaseRest("email_sync_state?on_conflict=account_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({account_id:account.id,history_id:profileData.historyId||state?.history_id||null,page_token:nextPageToken||null,initial_sync_completed_at:mode==="initial"?now:undefined,last_full_sync_at:mode==="initial"?now:undefined,last_incremental_sync_at:mode==="incremental"?now:undefined,last_error_code:null,last_error_detail:null,updated_at:now})});
  await supabaseRest(`email_accounts?id=eq.${account.id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({gmail_history_id:profileData.historyId||null,last_sync_at:now,last_verified_at:now,synced_message_count:profileData.messagesTotal||stored,status:"connected",status_detail:null,updated_at:now})});
  return {mode,processed:stored,historyId:profileData.historyId||null,nextPageToken:nextPageToken||null};
}

async function persistMessage(account:EmailAccount,workspaceIds:string[],message:GmailMessage){
  const headers=Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
  const from=address(headers.from),to=addresses(headers.to),cc=addresses(headers.cc);const inbound=from.toLowerCase()!==account.email_address.toLowerCase();
  const match=await matchLead(workspaceIds,message.threadId,from,to,headers["in-reply-to"],headers.references);const workspaceId=match.workspaceId||workspaceIds[0];if(!workspaceId)return;
  const textBody=decodeParts(message.payload,"text/plain");const htmlBody=sanitizeHtml(decodeParts(message.payload,"text/html"));const classification=inbound?classify(`${headers.subject||""}\n${textBody||message.snippet||""}`):{value:"sent",confidence:1,reason:"outbound message"};
  const threadResponse=await supabaseRest("email_threads?on_conflict=account_id,gmail_thread_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({account_id:account.id,workspace_id:workspaceId,gmail_thread_id:message.threadId,lead_id:match.leadId,subject:headers.subject||"(sans objet)",snippet:message.snippet||"",classification:classification.value==="sent"?"unclassified":classification.value,confidence:classification.confidence,unread:(message.labelIds||[]).includes("UNREAD"),needs_association:!match.leadId,candidate_lead_ids:match.candidateIds,last_message_at:new Date(Number(message.internalDate||Date.now())).toISOString(),updated_at:new Date().toISOString()})});
  if(!threadResponse.ok)throw new Error(`Thread Gmail non persisté (${threadResponse.status}).`);const thread=(await threadResponse.json() as Array<{id:string}>)[0];
  const saved=await supabaseRest("email_messages?on_conflict=account_id,gmail_message_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({account_id:account.id,connection_id:null,workspace_id:workspaceId,email_thread_id:thread.id,lead_id:match.leadId,provider_message_id:message.id,gmail_message_id:message.id,thread_id:message.threadId,gmail_thread_id:message.threadId,history_id:message.historyId||null,direction:inbound?"inbound":"outbound",classification:classification.value,subject:headers.subject||"(sans objet)",snippet:message.snippet||"",labels:message.labelIds||[],message_id_header:headers["message-id"]||null,in_reply_to:headers["in-reply-to"]||null,references_header:headers.references||null,from_address:from,to_addresses:to,cc_addresses:cc,sent_at:new Date(Number(message.internalDate||Date.now())).toISOString(),text_body:textBody,html_body:htmlBody,has_attachments:attachments(message.payload).length>0,association_reason:match.reason,raw_headers:{date:headers.date||null},collected_at:new Date().toISOString()})});
  if(!saved.ok)throw new Error(`Message Gmail non persisté (${saved.status}).`);const row=(await saved.json() as Array<{id:string}>)[0];
  if(inbound&&classification.value!=="automatic"){await supabaseRest("email_classifications",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:workspaceId,message_id:row.id,classification:classification.value,confidence:classification.confidence,human_validated:classification.confidence>=0.8,rationale:classification.reason})});}
  const files=attachments(message.payload);if(files.length)await supabaseRest("email_attachments?on_conflict=message_id,gmail_attachment_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(files.map(file=>({message_id:row.id,...file})))});
}

async function matchLead(workspaceIds:string[],gmailThreadId:string,from:string,to:string[],inReplyTo?:string,references?:string){
  const known=await supabaseRest(`email_threads?gmail_thread_id=eq.${encodeURIComponent(gmailThreadId)}&workspace_id=in.(${workspaceIds.join(",")})&lead_id=not.is.null&select=lead_id,workspace_id&limit=2`);const knownRows=known.ok?await known.json() as Array<{lead_id:string;workspace_id:string}>:[];if(knownRows.length===1)return{leadId:knownRows[0].lead_id,workspaceId:knownRows[0].workspace_id,candidateIds:[],reason:"gmail_thread"};
  const refs=[inReplyTo,...String(references||"").split(/\s+/)].filter(Boolean);if(refs.length){const linked=await supabaseRest(`email_messages?message_id_header=in.(${refs.map(v=>`"${encodeURIComponent(String(v))}"`).join(",")})&lead_id=not.is.null&select=lead_id,workspace_id&limit=3`);const rows=linked.ok?await linked.json() as Array<{lead_id:string;workspace_id:string}>:[];if(rows.length===1)return{leadId:rows[0].lead_id,workspaceId:rows[0].workspace_id,candidateIds:[],reason:"reply_headers"};}
  const emails=[from,...to].map(x=>x.toLowerCase()).filter(Boolean);const candidates=new Map<string,{id:string;workspace_id:string}>();for(const email of emails){for(const table of ["leads","lead_contacts"]){const r=await supabaseRest(`${table}?workspace_id=in.(${workspaceIds.join(",")})&email=ilike.${encodeURIComponent(email)}&select=id,workspace_id${table==="lead_contacts"?",lead_id":""}&limit=10`);const rows=r.ok?await r.json() as Array<{id:string;lead_id?:string;workspace_id:string}>:[];for(const row of rows)candidates.set(row.lead_id||row.id,{id:row.lead_id||row.id,workspace_id:row.workspace_id});}}
  const all=[...candidates.values()];return all.length===1?{leadId:all[0].id,workspaceId:all[0].workspace_id,candidateIds:[],reason:"exact_email"}:{leadId:null,workspaceId:all[0]?.workspace_id||workspaceIds[0],candidateIds:all.map(x=>x.id),reason:all.length>1?"ambiguous_email":"no_match"};
}

export const classify=classifyEmailReply;

function address(value?:string){const match=String(value||"").match(/<([^>]+)>/);return(match?.[1]||String(value||"")).trim().toLowerCase();}
function addresses(value?:string){return String(value||"").split(",").map(address).filter(Boolean);}
function b64(value:string){try{return new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")),c=>c.charCodeAt(0)));}catch{return"";}}
function decodeParts(part:GmailPart|undefined,mime:string):string{if(!part)return"";if(part.mimeType===mime&&part.body?.data)return b64(part.body.data);for(const child of part.parts||[]){const value=decodeParts(child,mime);if(value)return value;}return"";}
function sanitizeHtml(value:string){return value.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/\son\w+\s*=\s*["'][^"']*["']/gi,"").replace(/javascript:/gi,"").slice(0,250000);}
function attachments(part:GmailPart|undefined):Array<{gmail_attachment_id:string;filename:string;mime_type:string|null;size_bytes:number|null}>{if(!part)return[];const own=part.filename&&part.body?.attachmentId?[{gmail_attachment_id:part.body.attachmentId,filename:part.filename,mime_type:part.mimeType||null,size_bytes:part.body.size||null}]:[];return own.concat((part.parts||[]).flatMap(attachments));}

export function encodeRawEmail(value:string){const bytes=new TextEncoder().encode(value);let binary="";bytes.forEach(byte=>binary+=String.fromCharCode(byte));return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");}
