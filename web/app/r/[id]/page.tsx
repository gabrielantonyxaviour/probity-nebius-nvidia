import { Review } from "@/components/review/review";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Review requestId={id} />;
}
