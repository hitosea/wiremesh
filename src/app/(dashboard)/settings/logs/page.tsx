import { redirect } from "next/navigation";

export default function AuditLogsPage() {
  redirect("/settings?tab=logs");
}
