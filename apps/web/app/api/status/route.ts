import { getPublicStatus, PUBLIC_STATUS_REVALIDATE_SECONDS } from "@/lib/status/public"

/**
 * GET /api/status — retrato público da página de status em JSON
 * (`PublicStatusSnapshot`, packages/core/src/status/public.ts). Público, sem
 * sessão e sem nenhum dado interno.
 *
 * Route Handlers do Next 16 não são cacheados por padrão (docs do Next:
 * 01-app/01-getting-started/15-route-handlers, "Caching"); o cabeçalho abaixo
 * deixa o CDN guardar a resposta por 30 s e servir a anterior por mais 60 s
 * enquanto renova, para os acessos dos clientes não virarem invocações. No
 * servidor, `getPublicStatus` ainda guarda o retrato por 30 s.
 */

export const maxDuration = 10

export async function GET() {
  const snapshot = await getPublicStatus()

  if (!snapshot) {
    return Response.json(
      { error: "Não foi possível verificar o status agora." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "30" },
      }
    )
  }

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": `public, s-maxage=${PUBLIC_STATUS_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
    },
  })
}
