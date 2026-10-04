"use server"

import { registerSharedProposalView } from "@/lib/propostas/share"

/**
 * Registra a abertura do link pelo cliente (data e hora). Chamada pelo
 * navegador de quem abriu a página, não pelo servidor ao renderizar: o robô de
 * prévia do WhatsApp busca a URL mas não executa JavaScript, então o corretor
 * não vê "o cliente leu" por causa da prévia.
 *
 * Pública e sem sessão. Não devolve nada: nem sucesso, nem se o token existe.
 */
export async function registerProposalView(token: string): Promise<void> {
  await registerSharedProposalView(token)
}
