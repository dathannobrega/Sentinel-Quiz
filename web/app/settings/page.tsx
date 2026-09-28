import { SettingsShell } from "@/features/settings/components/settings-shell";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("settings");

export default function Page() {
  return <SettingsShell />;
}
