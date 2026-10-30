import { Plans } from "@/components/inapp/plans";

export const metadata = { title: "Pricing · Probity" };

/** In-app pricing: signed-in users compare plans without leaving the product. */
export default function InAppPricingPage() {
  return <Plans />;
}
