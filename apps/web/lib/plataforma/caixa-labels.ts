// Textos da área interna "Lista da Caixa" (pt-BR). Sem `server-only`: a rota de
// envio, a página e o formulário do navegador usam os mesmos rótulos.

import type { CaixaSyncFailureReason, CaixaSyncOrigin } from "@workspace/core/caixa/catalog-import"
import type { CaixaRejectionReason } from "@workspace/core/caixa/csv"

/** Rota que recebe o arquivo (POST, corpo gzip ou CSV). */
export const CAIXA_UPLOAD_API_PATH = "/plataforma/caixa/enviar"

/**
 * Teto do corpo da requisição. A Vercel recusa corpo acima de 4,5 MB
 * (https://vercel.com/docs/functions/limitations#request-body-size); o
 * navegador compacta o CSV (gzip), que cai para uma fração disso.
 */
export const CAIXA_UPLOAD_MAX_BODY_BYTES = 4 * 1024 * 1024

/** Resposta JSON da rota de envio (só contagens; nenhum dado de imóvel). */
export type CaixaUploadResponse =
  | {
      ok: true
      result: "changed"
      generatedOn: string | null
      total: number
      inserted: number
      updated: number
      rejected: number
      delisted: number
      rejectedByReason: Partial<Record<CaixaRejectionReason, number>>
    }
  | { ok: true; result: "unchanged" }
  | {
      ok: false
      reason:
        | CaixaSyncFailureReason
        | "sem_arquivo"
        | "tipo_invalido"
        | "origem_invalida"
        | "somente_leitura"
      message: string
      rejectedByReason?: Partial<Record<CaixaRejectionReason, number>>
    }

export const CAIXA_ORIGIN_LABELS: Record<CaixaSyncOrigin, string> = {
  download_automatico: "Download automático",
  envio_manual: "Envio manual",
}

/** Motivo de falha → frase para quem enviou (sem jargão). */
export const CAIXA_FAILURE_MESSAGES: Record<CaixaSyncFailureReason, string> = {
  sem_chave_do_servidor:
    "O servidor está sem a chave do catálogo (CAIXA_SERVER_KEY). Nada foi gravado.",
  supabase_nao_configurado: "O servidor está sem a configuração do banco. Nada foi gravado.",
  estado_indisponivel:
    "Não foi possível ler a última carga no banco. Nada foi gravado; tente de novo em instantes.",
  download_falhou: "O download automático falhou.",
  http_nao_ok: "O site da Caixa recusou o download automático.",
  redirecionado: "O site da Caixa redirecionou o download automático.",
  resposta_html: "O site da Caixa devolveu uma página em vez do arquivo.",
  leitura_falhou: "Não foi possível ler o arquivo recebido.",
  arquivo_grande_demais: "O arquivo passa de 20 MB. Confira se é a lista da Caixa.",
  cabecalho_mudou:
    "As colunas do arquivo não são as da lista da Caixa. Baixe de novo pelo link oficial e envie sem abrir nem salvar no Excel.",
  arquivo_vazio: "O arquivo não tem nenhum imóvel válido.",
  lista_de_um_estado:
    'Este arquivo é a lista de um estado só. Baixe a lista geral ("Todos os estados") para não tirar os outros estados do catálogo.',
  poucos_registros:
    "O arquivo tem menos de 1.000 imóveis válidos, o que indica download incompleto. O catálogo anterior foi mantido.",
  gravacao_falhou:
    "O banco recusou a gravação no meio da carga. Nenhum imóvel foi marcado como fora da lista; envie de novo.",
  fechamento_falhou:
    "A carga não pôde ser concluída. Nenhum imóvel foi marcado como fora da lista; envie de novo.",
  carga_simultanea:
    "Outra carga da lista estava sendo gravada ao mesmo tempo. Nada foi marcado como fora da lista; envie de novo.",
}

export const CAIXA_REJECTION_LABELS: Record<CaixaRejectionReason, string> = {
  campos: "número de colunas errado",
  numero: "número do imóvel inválido",
  numero_repetido: "número repetido",
  uf: "UF inválida",
  cidade: "sem cidade",
  endereco: "sem endereço",
  preco: "preço inválido",
  link: "link fora do site da Caixa",
  limite: "acima do limite de linhas",
}

/** Rótulo do motivo guardado no evento (texto livre antigo vira "Outro motivo"). */
export function caixaFailureLabel(reason: string | null | undefined): string | null {
  if (!reason) {
    return null
  }

  return Object.prototype.hasOwnProperty.call(CAIXA_FAILURE_MESSAGES, reason)
    ? CAIXA_FAILURE_MESSAGES[reason as CaixaSyncFailureReason]
    : "Outro motivo."
}
