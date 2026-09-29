import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { requireLeadAccess } from "@/lib/lead-access";

export const dynamic = "force-dynamic";
const MAX_REVIEWS = 5;

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const user=await getAuthorizedChatGPTUser();if(!user)return Response.json({error:"Accès non autorisé."},{status:401});
  const id=(await params).id;
  let access;try{access=await requireLeadAccess(user,id);}catch{return Response.json({error:"Lead introuvable."},{status:404});}
  const cached=await supabaseRest(`lead_review_insights?lead_id=eq.${encodeURIComponent(id)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&order=fetched_at.desc&limit=1`);
  const cachedRows=cached.ok?await cached.json() as Array<Record<string,unknown>>:[];
  if(cachedRows[0])return Response.json({cached:true,insight:{...cachedRows[0],summary:summaryFrom(cachedRows[0])},reviews:Array.isArray(cachedRows[0].review_sample)?cachedRows[0].review_sample:[],attribution:"Google",costUsd:0,notice:"Échantillon d’au plus cinq avis fourni par Google, pas la totalité des avis."});
  const leadResponse=await supabaseRest(`leads?id=eq.${encodeURIComponent(id)}&select=google_place_id&limit=1`);const leads=leadResponse.ok?await leadResponse.json() as Array<{google_place_id:string|null}>:[];
  const placeId=leads[0]?.google_place_id;if(!placeId)return Response.json({error:"Aucun Google Place ID fiable pour ce lead."},{status:422});
  const apiKey=process.env.GOOGLE_MAPS_API_KEY||process.env.GOOGLE_PLACES_API_KEY||process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;if(!apiKey)return Response.json({error:"Google Places n’est pas configuré."},{status:503});
  const response=await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`,{headers:{"X-Goog-Api-Key":apiKey,"X-Goog-FieldMask":"id,displayName,rating,userRatingCount,reviews,googleMapsUri,attributions"},cache:"no-store"});
  if(!response.ok)return Response.json({error:`Google Places a refusé la lecture (${response.status}).`},{status:502});
  const place=await response.json() as Record<string,unknown>;const rawReviews=Array.isArray(place.reviews)?place.reviews.slice(0,MAX_REVIEWS):[];
  const reviews=rawReviews.map(item=>{const review=item as Record<string,unknown>;const text=(review.text as Record<string,unknown>|undefined)?.text;return{rating:Number(review.rating||0),text:typeof text==="string"?text.slice(0,1200):"",publishedAt:String(review.publishTime||""),author:String((review.authorAttribution as Record<string,unknown>|undefined)?.displayName||"")};});
  const positiveThemes=reviewThemes(reviews.filter(item=>item.rating>=4).map(item=>item.text));const negativeThemes=reviewThemes(reviews.filter(item=>item.rating<=2).map(item=>item.text));const summary=positiveThemes.length||negativeThemes.length?`Positif : ${positiveThemes.join(", ")||"aucun thème récurrent"}. Négatif : ${negativeThemes.join(", ")||"aucun thème récurrent"}. À valider avant utilisation commerciale.`:"Échantillon insuffisant pour dégager un thème fiable.";const insight={workspace_id:access.workspace.id,lead_id:id,google_place_id:placeId,rating:Number(place.rating||0)||null,review_count:Number(place.userRatingCount||0),positive_themes:positiveThemes,negative_themes:negativeThemes,communication_opportunities:negativeThemes,review_sample:reviews,source_url:String(place.googleMapsUri||`https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`),provider_review_count:reviews.length,attribution:"Google",fetched_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString()};
  await supabaseRest("lead_review_insights",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify(insight)});
  return Response.json({cached:false,insight:{...insight,summary},reviews,googleMapsUri:place.googleMapsUri||null,attribution:"Google",costUsd:null,limit:MAX_REVIEWS,notice:"Échantillon d’au plus cinq avis fourni par Google, pas la totalité des avis."});
}

function reviewThemes(texts:string[]){const candidates=[["service",/service|accueil|équipe/i],["qualité",/qualité|excellent|professionnel/i],["délais",/délai|attente|rapide|retard/i],["prix",/prix|tarif|cher|coût/i],["communication",/communication|réponse|contact/i]] as const;return candidates.filter(([,pattern])=>texts.filter(text=>pattern.test(text)).length>=2).map(([label])=>label);}
function summaryFrom(row:Record<string,unknown>){const positive=Array.isArray(row.positive_themes)?row.positive_themes.join(", "):"";const negative=Array.isArray(row.negative_themes)?row.negative_themes.join(", "):"";return positive||negative?`Positif : ${positive||"aucun thème récurrent"}. Négatif : ${negative||"aucun thème récurrent"}. À valider avant utilisation commerciale.`:"Échantillon insuffisant pour dégager un thème fiable.";}
