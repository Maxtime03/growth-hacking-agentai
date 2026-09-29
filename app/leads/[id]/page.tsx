import LeadDetailRich from "@/components/lead-detail-rich";
import LeadInlineEditorLoader from "@/components/lead-inline-editor-loader";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id=(await params).id;
  return <><LeadInlineEditorLoader id={id}/><LeadDetailRich id={id}/></>;
}
