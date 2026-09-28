import { DashboardShell } from "@/features/dashboard/components/dashboard-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("dashboard");

export default function Page() {
  return <DashboardShell />;
}
