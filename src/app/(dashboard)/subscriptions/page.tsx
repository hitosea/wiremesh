import { redirect } from "next/navigation";

export default function SubscriptionsPage() {
  redirect("/devices?tab=subscriptions");
}
