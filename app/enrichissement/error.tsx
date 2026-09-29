"use client";
import { useEffect } from "react";
export default function EnrichmentError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){useEffect(()=>{console.error("Enrichment route boundary",error.message);},[error]);return <main className="route-error-boundary"><section><span>Enrichissement</span><h1>Une ligne incomplète n’a pas pu être affichée.</h1><p>Les autres données restent intactes. Réessayez pour recharger une liste normalisée.</p><button onClick={reset}>Réessayer</button></section></main>;}
