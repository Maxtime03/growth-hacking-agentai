import fs from "node:fs/promises";
const env=Object.fromEntries((await fs.readFile(".env.local","utf8")).split(/\r?\n/).filter(line=>line&&!line.startsWith("#")&&line.includes("=")).map(line=>{const i=line.indexOf("=");return[line.slice(0,i),line.slice(i+1).replace(/^['\"]|['\"]$/g,"")]}));
const token=env.SUPABASE_TOKEN_SECRET||env.SUPABASE_ACCESS_TOKEN;const ref=env.SUPABASE_PROJECT_REF||new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];if(!token||!ref)throw new Error("Supabase management credentials unavailable.");
const apply=process.argv.includes("--apply");
const query=`begin;
select pg_advisory_xact_lock(hashtext('netai:ephreem-kalonji'));
create temp table ephreem_result(id uuid,action text) on commit drop;
do $$ declare v_workspace uuid;v_ids uuid[];v_lead uuid;v_count int;v_contact uuid; begin
  select id into strict v_workspace from public.workspaces where slug='lexicon';
  select array_agg(distinct candidate_id) into v_ids from (
    select l.id candidate_id from public.leads l left join public.lead_contacts c on c.lead_id=l.id
    where l.workspace_id=v_workspace and (
      regexp_replace(coalesce(l.phone,''),'[^0-9]','','g') in ('0472818934','32472818934') or
      regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') in ('0472818934','32472818934') or
      translate(lower(coalesce(c.full_name,'')),'éèêë','eeee') like '%ephreem%kalonji%' or
      translate(lower(coalesce(l.company_name,'')),'éèêë','eeee') like '%ephreem%kalonji%' or
      lower(coalesce(l.external_id,''))='manual-ephreem-kalonji'
    )
  ) candidates;
  v_count=coalesce(cardinality(v_ids),0);if v_count>1 then raise exception 'Plusieurs doublons Ephreem détectés (%)',v_count;end if;
  if v_count=1 then
    v_lead=v_ids[1];
    update public.leads set company_name='Représentation/consulat de la République démocratique du Congo — entité juridique exacte à confirmer',phone='+32 472 81 89 34',pipeline_stage='won',deal_status='won',temperature='chaud',opportunity_value_min=900,opportunity_value_max=1500,currency='EUR',tax_included=false,next_action='Confirmer le périmètre exact, le montant final, les modalités et la facturation',notes='Démarches et autorisations pour une interview jugées complexes et longues. Appel chaleureux et rendez-vous fixé un vendredi après 15 h à Bruxelles. Solution vendue ou validée le 25 septembre 2026 ; statut administratif et montant final à confirmer.',source_detail='Saisie utilisateur',legal_entity='Représentation/consulat de la République démocratique du Congo — à confirmer',office_scope='Bruxelles — périmètre exact à confirmer',updated_at=now(),raw_data=coalesce(raw_data,'{}'::jsonb)||jsonb_build_object('contact_name','Ephréem Kalonji','title','chargé des affaires économiques','source','saisie utilisateur','commercial_update_date','2026-09-25','commercial_update','solution vendue ou validée','facts_to_verify',jsonb_build_array('entité juridique exacte','périmètre','montant final','modalités','facturation')) where id=v_lead;
    insert into ephreem_result values(v_lead,'updated');
  else
    insert into public.leads(workspace_id,external_id,company_name,phone,pipeline_stage,deal_status,temperature,opportunity_value_min,opportunity_value_max,currency,tax_included,next_action,notes,source_detail,legal_entity,office_scope,raw_data,updated_at)
    values(v_workspace,'manual-ephreem-kalonji','Représentation/consulat de la République démocratique du Congo — entité juridique exacte à confirmer','+32 472 81 89 34','won','won','chaud',900,1500,'EUR',false,'Confirmer le périmètre exact, le montant final, les modalités et la facturation','Démarches et autorisations pour une interview jugées complexes et longues. Appel chaleureux et rendez-vous fixé un vendredi après 15 h à Bruxelles. Solution vendue ou validée le 25 septembre 2026 ; statut administratif et montant final à confirmer.','Saisie utilisateur','Représentation/consulat de la République démocratique du Congo — à confirmer','Bruxelles — périmètre exact à confirmer',jsonb_build_object('contact_name','Ephréem Kalonji','title','chargé des affaires économiques','source','saisie utilisateur','commercial_update_date','2026-09-25','commercial_update','solution vendue ou validée','facts_to_verify',jsonb_build_array('entité juridique exacte','périmètre','montant final','modalités','facturation')),now()) returning id into v_lead;
    insert into ephreem_result values(v_lead,'created');
  end if;
  select id into v_contact from public.lead_contacts where lead_id=v_lead and (regexp_replace(coalesce(phone,''),'[^0-9]','','g') in ('0472818934','32472818934') or translate(lower(full_name),'éèêë','eeee') like '%ephreem%kalonji%') order by created_at limit 1 for update;
  if v_contact is null then insert into public.lead_contacts(workspace_id,lead_id,first_name,last_name,full_name,title,phone,source,confidence_score,is_primary) values(v_workspace,v_lead,'Ephréem','Kalonji','Ephréem Kalonji','chargé des affaires économiques','+32 472 81 89 34','saisie utilisateur',100,true); else update public.lead_contacts set first_name='Ephréem',last_name='Kalonji',full_name='Ephréem Kalonji',title='chargé des affaires économiques',phone='+32 472 81 89 34',source='saisie utilisateur',confidence_score=100,is_primary=true,updated_at=now() where id=v_contact;end if;
  insert into public.lead_activities(workspace_id,lead_id,activity_type,body,metadata) values(v_workspace,v_lead,'manual_user_update','Saisie utilisateur : nom, fonction, téléphone, contexte, interaction antérieure, validation commerciale du 25/09/2026, fourchette 900–1 500 EUR HTVA et prochaine action. À vérifier : entité juridique exacte, périmètre, montant final, modalités et facturation.',jsonb_build_object('source','saisie utilisateur','verified_fields',jsonb_build_array('nom','fonction','téléphone','contexte','interaction','date mise à jour commerciale','fourchette HTVA'),'to_verify',jsonb_build_array('entité juridique','périmètre','montant final','modalités','facturation')));
end $$;
select r.id,r.action,(select count(*) from public.leads l left join public.lead_contacts c on c.lead_id=l.id where l.workspace_id=(select id from public.workspaces where slug='lexicon') and (regexp_replace(coalesce(l.phone,''),'[^0-9]','','g') in ('0472818934','32472818934') or regexp_replace(coalesce(c.phone,''),'[^0-9]','','g') in ('0472818934','32472818934') or translate(lower(coalesce(c.full_name,'')),'éèêë','eeee') like '%ephreem%kalonji%'))::int as matches,(select count(*) from public.lead_activities a where a.lead_id=r.id and a.activity_type='manual_user_update')::int as history_rows from ephreem_result r;
${apply?"commit;":"rollback;"}`;
const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({query})});if(!response.ok)throw new Error(`Ephreem ${apply?"apply":"check"} failed (${response.status}): ${(await response.text()).slice(0,800)}`);console.log(JSON.stringify({ok:true,mode:apply?"applied":"transaction-check",result:await response.json()}));
