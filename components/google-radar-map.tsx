"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { google?: any; __netAiGoogleMapsPromise?: Promise<void>; __netAiGoogleMapsReady?: () => void; gm_authFailure?: () => void; }
}

export type RadarPoint = { lat: number; lon: number; label?: string; radiusKm?: number };
type MapLead = { id: string; company: string; score: number; location?: string; coordinates?: { lat: number; lon: number } };
const centers: Record<string, { lat: number; lng: number; zoom: number }> = { Belgique: { lat: 50.5039, lng: 4.4699, zoom: 8 }, France: { lat: 46.6034, lng: 1.8883, zoom: 6 }, "Pays-Bas": { lat: 52.1326, lng: 5.2913, zoom: 8 }, Luxembourg: { lat: 49.8153, lng: 6.1296, zoom: 10 } };

function loadGoogleMaps(key: string) {
  if (typeof window.google?.maps?.Map === "function") return Promise.resolve();
  if (window.__netAiGoogleMapsPromise) return window.__netAiGoogleMapsPromise;
  window.__netAiGoogleMapsPromise = new Promise((resolve, reject) => {
    window.gm_authFailure = () => reject(new Error("Google Maps a refusé la clé (restriction, API non activée ou facturation)."));
    const script = document.createElement("script"); script.dataset.netaiGoogleMaps = "true"; script.async = true;
    window.__netAiGoogleMapsReady = () => typeof window.google?.maps?.Map === "function" ? resolve() : reject(new Error("Google Maps n'a pas chargé la bibliothèque."));
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=marker&callback=__netAiGoogleMapsReady`;
    script.onerror = () => reject(new Error("Google Maps n'est pas accessible (réseau ou restriction de clé).")); document.head.appendChild(script);
  });
  return window.__netAiGoogleMapsPromise;
}

export default function GoogleRadarMap({ country, leads, selectedPoint, selectedLeadId, running, onAreaSelect, onLeadSelect }: { country: string; leads: MapLead[]; selectedPoint?: RadarPoint | null; selectedLeadId?: string | null; running?: boolean; onAreaSelect?: (point: RadarPoint) => void; onLeadSelect?: (lead: MapLead) => void }) {
  const container = useRef<HTMLDivElement>(null); const mapInstance = useRef<any>(null); const [error, setError] = useState<string | null>(null); const [cityQuery, setCityQuery] = useState(""); const [cityError, setCityError] = useState(""); const [searchingCity, setSearchingCity] = useState(false); const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
  useEffect(() => {
    if (!apiKey || !container.current) return;
    let cancelled = false; const listeners: any[] = [];
    loadGoogleMaps(apiKey).then(() => {
      if (cancelled || !container.current || !window.google?.maps) return;
      const fallback = centers[country] || centers.Belgique; const center = selectedPoint ? { lat: selectedPoint.lat, lng: selectedPoint.lon } : fallback;
      const map = new window.google.maps.Map(container.current, { center, zoom: selectedPoint ? 12 : fallback.zoom, mapTypeControl: true, streetViewControl: true, fullscreenControl: true, gestureHandling: "greedy", clickableIcons: false }); mapInstance.current = map; setError(null);
      if (selectedPoint) { new window.google.maps.Circle({ map, center, radius: (selectedPoint.radiusKm || 8) * 1000, strokeColor: "#a678ff", strokeWeight: 2, fillColor: "#7c3ff0", fillOpacity: 0.12 }); new window.google.maps.Marker({ map, position: center, title: selectedPoint.label || "Centre" }); }
      leads.filter((lead) => lead.coordinates).forEach((lead) => { const marker = new window.google.maps.Marker({ map, position: { lat: lead.coordinates!.lat, lng: lead.coordinates!.lon }, title: `${lead.company} · ${lead.score}/100` }); listeners.push(marker.addListener("click", () => onLeadSelect?.(lead))); });
      listeners.push(map.addListener("click", (event: any) => { const lat = event.latLng?.lat(); const lon = event.latLng?.lng(); if (Number.isFinite(lat) && Number.isFinite(lon)) onAreaSelect?.({ lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, radiusKm: 8 }); }));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Erreur Google Maps"));
    return () => { cancelled = true; listeners.forEach((listener) => listener?.remove?.()); };
  }, [apiKey, country, leads, selectedPoint, selectedLeadId, onAreaSelect, onLeadSelect]);
  function fallbackSelect(event: React.MouseEvent<HTMLDivElement>) { if (mapInstance.current) return; const rect = event.currentTarget.getBoundingClientRect(); const base = centers[country] || centers.Belgique; const lon = base.lng + ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 8; const lat = base.lat - ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 5; onAreaSelect?.({ lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)), label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, radiusKm: 8 }); }
  async function searchCity(event: React.FormEvent) { event.preventDefault(); if (!cityQuery.trim()) return; setSearchingCity(true); setCityError(""); try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(`${cityQuery}, ${country}`)}`, { headers: { "Accept-Language": "fr" } }); const rows = await response.json() as Array<{ lat: string; lon: string; display_name: string }>; if (!rows[0]) throw new Error("Ville introuvable."); onAreaSelect?.({ lat: Number(rows[0].lat), lon: Number(rows[0].lon), label: rows[0].display_name, radiusKm: 8 }); } catch (cause) { setCityError(cause instanceof Error ? cause.message : "Ville introuvable."); } finally { setSearchingCity(false); } }
  return <div className="google-map-wrap"><div ref={container} className="google-map-canvas" onClick={fallbackSelect} aria-label={`Carte interactive des prospects en ${country}`} />{(!apiKey || error) && <div className="google-map-missing" role="status"><strong>{!apiKey ? "Google Maps n'est pas configuré" : "Carte Google indisponible — mode interactif local actif"}</strong><span>{error || "Cliquez sur la carte pour sélectionner une zone."}</span></div>}<form className="map-city-search" onSubmit={searchCity}><input value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder={`Rechercher une ville en ${country}`} aria-label="Rechercher une ville"/><button type="submit" disabled={searchingCity}>{searchingCity ? "Recherche…" : "Sélectionner"}</button></form>{cityError && <div className="map-city-error">{cityError}</div>}{running && <div className="map-searching"><span className="spinner" />Apify collecte les entreprises. Vous pouvez quitter cette page : la recherche est enregistrée.</div>}<div className="map-click-hint">Recherchez une ville ou cliquez directement sur la carte</div></div>;
}
