import { checkStatusPing } from "@/lib/status/ping"

/**
 * GET /api/status/ping — sonda da página de status. O banco chama a cada
 * minuto (pg_cron + pg_net, segredo `status_probe_url` do Vault) para saber se
 * o app está de pé.
 *
 * 200 `{ ok: true, database: true, auth }` quando o app respondeu e o banco
 * também; 503 `{ ok: false, ... }` quando o banco não respondeu. `auth` diz se
 * o Auth do Supabase respondeu (entra na parte "Login e contas"). Nenhum dado
 * sensível. Levíssima: uma RPC `select true` e um GET no health do Auth, com
 * resultado guardado 10 s em memória e 10 s no CDN — não vira alvo caro.
 */

export const maxDuration = 5

const NO_INDEX = { "X-Robots-Tag": "noindex" }

export async function GET() {
  const result = await checkStatusPing()

  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: result.ok
      ? { ...NO_INDEX, "Cache-Control": "public, max-age=0, s-maxage=10" }
      : { ...NO_INDEX, "Cache-Control": "no-store" },
  })
}
