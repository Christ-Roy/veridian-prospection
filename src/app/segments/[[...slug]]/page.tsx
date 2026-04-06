import { SegmentPage } from "@/components/dashboard/segment-page";

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const segmentId = slug ? slug.join("/") : null;

  return <SegmentPage segmentId={segmentId} />;
}
