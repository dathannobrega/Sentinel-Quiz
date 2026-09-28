import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { pageMetadata } from "@/lib/i18n/metadata";

export const generateMetadata = pageMetadata("forgotPassword");

export default function Page() {
  return <ForgotPasswordForm />;
}
