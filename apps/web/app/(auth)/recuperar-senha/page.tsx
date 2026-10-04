import type { Metadata } from "next"

import { RecoverPasswordForm } from "@/app/(auth)/recuperar-senha/recover-password-form"

export const metadata: Metadata = {
  title: "Recuperar senha",
}

export default function RecuperarSenhaPage() {
  return <RecoverPasswordForm />
}
