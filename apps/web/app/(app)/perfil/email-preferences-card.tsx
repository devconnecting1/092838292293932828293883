import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { requireUser } from "@/lib/auth/session"
import { getEmailPreferences } from "@/lib/lembretes/preferences"

import { EmailPreferencesForm } from "./email-preferences-form"

/**
 * "E-mails e avisos automáticos" em Meu perfil: resumo diário, lembrete e aviso
 * de visita, lembrete de tarefa no celular e relatório semanal. Componente separado da página para não misturar com os
 * avisos no celular; a preferência fica em public.email_preferences.
 */
export async function EmailPreferencesCard() {
  const user = await requireUser()
  const preferences = await getEmailPreferences(user.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>E-mails e avisos automáticos</CardTitle>
        <CardDescription>
          Os e-mails vão para {user.email ?? "o seu e-mail"}. Tudo vale para todas as imobiliárias
          em que você trabalha.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preferences ? (
          <EmailPreferencesForm preferences={preferences} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar suas preferências agora. Recarregue a página.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
