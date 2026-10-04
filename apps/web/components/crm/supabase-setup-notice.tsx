import { CircleCheckIcon, CircleXIcon, InfoIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"

import { BrandLogo } from "@/components/crm/brand"
import { getSupabaseEnvStatus } from "@/lib/supabase/env"

function EnvStatusRow({
  name,
  ok,
  okLabel = "Definida",
  missingLabel = "Ausente",
}: {
  name: string
  ok: boolean
  okLabel?: string
  missingLabel?: string
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <code className="truncate font-mono text-xs">{name}</code>
      {ok ? (
        <Badge variant="secondary">
          <CircleCheckIcon data-icon="inline-start" />
          {okLabel}
        </Badge>
      ) : (
        <Badge variant="destructive">
          <CircleXIcon data-icon="inline-start" />
          {missingLabel}
        </Badge>
      )}
    </li>
  )
}

/** Tela exibida quando as variáveis do Supabase não estão configuradas. */
export function SupabaseSetupNotice() {
  const status = getSupabaseEnvStatus()

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4 md:p-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <BrandLogo className="mb-2" />
          <CardTitle>Configure o Supabase</CardTitle>
          <CardDescription>
            O CRM precisa das credenciais do seu projeto Supabase para entrar, criar contas e
            guardar os dados das imobiliárias.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ol className="flex list-decimal flex-col gap-3 ps-5 text-sm">
            <li>
              Crie o arquivo <code className="font-mono text-xs">apps/web/.env.local</code> (use{" "}
              <code className="font-mono text-xs">apps/web/.env.example</code> como modelo).
            </li>
            <li>
              Preencha as variáveis com os dados de{" "}
              <span className="font-medium">Project Settings &gt; API Keys</span> no painel do
              Supabase:
              <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {
                  "NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_..."
                }
              </pre>
            </li>
            <li>
              Reinicie o servidor de desenvolvimento (ou gere o build de novo). Variáveis{" "}
              <code className="font-mono text-xs">NEXT_PUBLIC_</code> são lidas na inicialização.
            </li>
          </ol>
          <Separator />
          <ul className="flex flex-col gap-2">
            <EnvStatusRow
              name="NEXT_PUBLIC_SUPABASE_URL"
              ok={status.hasUrl && status.isUrlValid}
              missingLabel={status.hasUrl ? "Inválida" : "Ausente"}
            />
            <EnvStatusRow
              name="NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
              ok={status.hasPublishableKey}
              okLabel={status.usesLegacyAnonKey ? "Usando ANON_KEY" : "Definida"}
            />
          </ul>
        </CardContent>
        <CardFooter>
          <Alert>
            <InfoIcon />
            <AlertTitle>Projetos antigos</AlertTitle>
            <AlertDescription>
              Se o projeto ainda usa a chave anon, defina{" "}
              <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no lugar da
              chave publicável.
            </AlertDescription>
          </Alert>
        </CardFooter>
      </Card>
    </div>
  )
}
