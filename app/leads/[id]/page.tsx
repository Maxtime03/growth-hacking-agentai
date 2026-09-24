import LeadDetailClient from "@/components/lead-detail-client";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <LeadDetailClient id={(await params).id} />;
}
