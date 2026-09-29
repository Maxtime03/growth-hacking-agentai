import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { syncGmailAccount } from "@/lib/email-crm";
export const dynamic="force-dynamic";
export async function POST(request:Request){const user=await getAuthorizedChatGPTUser();if(!user)return Response.json({error:"Accès non autorisé."},{status:401});try{const body=await request.json().catch(()=>({})) as {accountId?:string;full?:boolean};if(!body.accountId)return Response.json({error:"Compte Gmail absent."},{status:400});return Response.json(await syncGmailAccount(user,body.accountId,Boolean(body.full)));}catch(error){return Response.json({error:error instanceof Error?error.message:"Synchronisation Gmail impossible."},{status:503});}}
