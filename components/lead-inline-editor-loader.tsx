"use client";
import { useCallback, useEffect, useState } from "react";
import LeadInlineEditor from "@/components/lead-inline-editor";
type Row=Record<string,unknown>;
export default function LeadInlineEditorLoader({id}:{id:string}){const[lead,setLead]=useState<Row|null>(null);const load=useCallback(async()=>{const response=await fetch(`/api/leads/${encodeURIComponent(id)}`,{cache:"no-store"});if(response.ok)setLead((await response.json()).item)},[id]);useEffect(()=>{void load()},[load]);return lead?<div className="lead-inline-editor-shell"><LeadInlineEditor lead={lead} onSaved={()=>void load()}/></div>:null}
