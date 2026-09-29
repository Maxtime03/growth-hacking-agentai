import { runtimeEnv } from "./runtime-env.ts";

type OAuthState={nonce:string;ownerEmail:string;workspace:string;returnPath:"/settings/email";redirectUri:string;issuedAt:number};

export function googleRedirectUri(origin:string){
  const local=/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
  const value=local?`${origin}/api/email/google/callback`:runtimeEnv("GOOGLE_OAUTH_REDIRECT_URI")||`${origin}/api/email/google/callback`;
  const parsed=new URL(value);
  if(parsed.pathname!=="/api/email/google/callback"||parsed.search||parsed.hash||(!local&&parsed.protocol!=="https:"))throw new Error("GOOGLE_OAUTH_REDIRECT_URI invalide.");
  return parsed.toString();
}

export async function signGoogleOAuthState(value:OAuthState){const payload=base64url(new TextEncoder().encode(JSON.stringify(value)));return `${payload}.${await signature(payload)}`;}
export async function verifyGoogleOAuthState(value:string|undefined|null):Promise<OAuthState|null>{if(!value)return null;const[payload,provided,...extra]=value.split(".");if(!payload||!provided||extra.length)return null;const expected=await signature(payload);if(!constantTime(expected,provided))return null;try{const parsed=JSON.parse(new TextDecoder().decode(unbase64url(payload))) as OAuthState;if(!parsed.nonce||!parsed.ownerEmail||!parsed.workspace||parsed.returnPath!=="/settings/email"||!parsed.redirectUri||Date.now()-parsed.issuedAt>600000||parsed.issuedAt>Date.now()+30000)return null;return parsed;}catch{return null;}}

async function signature(payload:string){const secret=runtimeEnv("TOKEN_ENCRYPTION_KEY");if(!secret)throw new Error("TOKEN_ENCRYPTION_KEY absent.");const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return base64url(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload))));}
function constantTime(left:string,right:string){if(left.length!==right.length)return false;let diff=0;for(let index=0;index<left.length;index++)diff|=left.charCodeAt(index)^right.charCodeAt(index);return diff===0;}
function base64url(bytes:Uint8Array){let binary="";bytes.forEach(byte=>binary+=String.fromCharCode(byte));return btoa(binary).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");}
function unbase64url(value:string){const normalized=value.replaceAll("-","+").replaceAll("_","/").padEnd(Math.ceil(value.length/4)*4,"=");const binary=atob(normalized);return Uint8Array.from(binary,character=>character.charCodeAt(0));}
