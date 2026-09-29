import fs from "node:fs/promises";
const env=Object.fromEntries((await fs.readFile(".env.local","utf8")).split(/\r?\n/).filter(line=>line&&!line.startsWith("#")&&line.includes("=")).map(line=>{const i=line.indexOf("=");return[line.slice(0,i),line.slice(i+1).replace(/^['\"]|['\"]$/g,"")]}));
const token=env.SUPABASE_TOKEN_SECRET||env.SUPABASE_ACCESS_TOKEN;const ref=env.SUPABASE_PROJECT_REF||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];if(!token||!ref)throw new Error("Supabase management credentials unavailable.");
async function sql(query){const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({query})});if(!response.ok)throw new Error(`Database test failed (${response.status}): ${(await response.text()).slice(0,500)}`);return response.json();}
const ep=await sql("select count(*)::int as matches, count(distinct id)::int as distinct_matches, count(*) filter(where phone is not null)::int as with_phone from public.leads where translate(lower(coalesce(company_name,'')),'éèêë','eeee') like '%ephreem%' or translate(lower(coalesce(raw_data->>'contact_name','')),'éèêë','eeee') like '%ephreem%' or lower(coalesce(raw_data->>'contact_name','')) like '%kalonji%' or (lower(coalesce(company_name,'')) ~ 'congo|consulat' and lower(coalesce(raw_data::text,'')) ~ 'affaire|kalonji');");
const result=await sql(`begin;
do $$ declare v_workspace uuid; v_lead uuid; v_draft uuid; begin
 select w.id into v_workspace from public.workspaces w where w.slug='lexicon' limit 1;
 select l.id into v_lead from public.leads l where l.workspace_id=v_workspace order by l.created_at limit 1;
 if v_lead is null then raise exception 'No Lexicon lead available'; end if;
 insert into public.email_drafts(workspace_id,lead_id,account_id,recipient,subject,icebreaker,body,signature,status,version,is_current,created_by_email) values(v_workspace,v_lead,null,'controlled@example.test','Preuve persistance','Preuve issue du lead','Version initiale','Net.AI OS','cancelled',1,false,'test@local') returning id into v_draft;
 insert into public.email_draft_versions(draft_id,workspace_id,version,subject,body,change_reason,created_by_email) values(v_draft,v_workspace,1,'Preuve persistance','Version initiale','test-create','test@local');
 update public.email_drafts set body='Version restaurée',version=2,last_saved_at=now() where id=v_draft;
 insert into public.email_draft_versions(draft_id,workspace_id,version,subject,body,change_reason,created_by_email) values(v_draft,v_workspace,2,'Preuve persistance','Version restaurée','test-update','test@local');
 insert into public.call_activities(workspace_id,lead_id,outcome,notes,created_by_email) values(v_workspace,v_lead,'callback','Test transactionnel sans appel réel','test@local');
 end $$;
select d.subject,d.body,d.version,(select count(*) from public.email_draft_versions v where v.draft_id=d.id)::int as versions,(select count(*) from public.call_activities c where c.lead_id=d.lead_id and c.created_by_email='test@local')::int as call_rows from public.email_drafts d where d.created_by_email='test@local' order by d.created_at desc limit 1;
rollback;`);
console.log(JSON.stringify({ok:true,epreem:ep,durableTransaction:result,noRealEmail:true}));
