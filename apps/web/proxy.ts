import type { NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Todas as rotas, exceto arquivos estáticos e de otimização de imagem.
     * Server Actions são POSTs para a própria rota e também passam por aqui.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest)$).*)",
    /*
     * O feed termina em .xml (excluído acima), mas precisa do proxy: no
     * subdomínio, /api/feeds/vrsync.xml é reescrito para /api/feeds/{slug}/vrsync.xml
     * e o header x-tenant-slug forjado é descartado.
     */
    "/api/feeds/:path*",
  ],
}
