import { CircleAlertIcon, KeyRoundIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import type { PlatformRpcFailure } from "@/lib/plataforma/rpc"

const TITLES: Record<PlatformRpcFailure["reason"], string> = {
  sem_acesso: "Sem acesso",
  sem_chave: "Falta a chave do console no servidor",
  supabase_nao_configurado: "Banco não configurado",
  chave_recusada: "A chave do console não confere",
  dados_invalidos: "Resposta inesperada do banco",
  falha: "Não foi possível consultar o banco",
}

/**
 * Aviso padrão quando uma RPC global do console não pôde ser chamada. Os
 * próximos módulos usam o mesmo componente com o `PlatformRpcFailure` de
 * `withPlatformRpc`.
 */
export function PlatformRpcFailureAlert({ failure }: { failure: PlatformRpcFailure }) {
  const isConfiguration = failure.reason === "sem_chave" || failure.reason === "chave_recusada"

  return (
    <Alert variant={failure.reason === "sem_chave" ? "default" : "destructive"}>
      {isConfiguration ? <KeyRoundIcon /> : <CircleAlertIcon />}
      <AlertTitle>{TITLES[failure.reason]}</AlertTitle>
      <AlertDescription>
        <p>{failure.message}</p>
        {isConfiguration ? (
          <p>
            No SQL Editor do Supabase:{" "}
            <code className="font-mono break-words">
              select decrypted_secret from vault.decrypted_secrets where name =
              &apos;platform_server_key&apos;;
            </code>{" "}
            Nada quebra enquanto isso: variáveis, rotinas da Vercel e Imóveis da Caixa continuam
            visíveis.
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
