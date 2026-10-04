import { z } from "zod"

// Schema compartilhado entre o formulário (navegador) e a Server Action.
// Entrada e saída continuam string, como no resto de /configuracoes.

/**
 * Conexão da conta da Meta. O token é DO CLIENTE: ele cola aqui, o servidor
 * manda direto para o Vault e nem o formulário nem a tela mostram o valor de
 * volta. Nada de confirmar por e-mail, nada de guardar em texto.
 */
export const metaConnectionSchema = z.object({
  pageId: z
    .string()
    .trim()
    .min(1, "Informe o ID da sua Página do Facebook.")
    .max(120, "O ID da Página é longo demais.")
    .regex(/^[0-9]{1,32}$/, "O ID da Página tem só números (copie do painel da Meta)."),
  accessToken: z
    .string()
    .trim()
    .min(32, "Cole o token de acesso da Página (ele é longo).")
    .max(4096, "Esse token é longo demais para ser válido.")
    .regex(/^\S+$/, "O token não pode ter espaços."),
  pageName: z.string().trim().max(120, "O nome é longo demais.").optional(),
})

export type MetaConnectionValues = z.infer<typeof metaConnectionSchema>

export const META_CONNECTION_DEFAULTS: MetaConnectionValues = {
  pageId: "",
  accessToken: "",
  pageName: "",
}
