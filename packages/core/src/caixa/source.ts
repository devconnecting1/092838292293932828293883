/**
 * Origem dos dados: a lista pública de imóveis que a Caixa Econômica Federal
 * publica para download em `download-lista.asp`.
 *
 * Nada aqui faz requisição: são só constantes e derivações puras. O módulo
 * nunca copia a foto nem guarda a URL dela — a URL é montada na renderização a
 * partir do número do imóvel (ver `buildCaixaPhotoUrl`).
 */

/** Host único da Caixa aceito em qualquer URL exibida ou montada pelo módulo. */
export const CAIXA_ORIGIN = "https://venda-imoveis.caixa.gov.br"

/** Arquivo nacional (27 UFs num único CSV). Uma requisição por dia, no máximo. */
export const CAIXA_LIST_URL = `${CAIXA_ORIGIN}/listaweb/Lista_imoveis_geral.csv`

/** Página da Caixa que oferece o arquivo; é a fonte a citar para o usuário. */
export const CAIXA_DOWNLOAD_PAGE_URL = `${CAIXA_ORIGIN}/sistema/download-lista.asp`

/** Crédito obrigatório em toda foto exibida. */
export const CAIXA_PHOTO_CREDIT = "Foto: CAIXA"

/** Nome da fonte, para rótulos de tela. */
export const CAIXA_SOURCE_LABEL = "CAIXA Econômica Federal"

/** O número do imóvel na Caixa tem no máximo 13 dígitos (a URL da foto o preenche com zeros). */
const LISTING_NUMBER_LENGTH = 13

/** Índice da primeira foto de um imóvel; as seguintes são 22, 23, ... */
const FIRST_PHOTO_INDEX = 21

/**
 * **Teto de tentativas, NÃO a quantidade de fotos de um imóvel.**
 *
 * A investigação da fonte viu um imóvel com 3 fotos (21, 22, 23) e outro com
 * uma só (o índice 22 devolveu 404). Ninguém confirmou que 3 é o máximo, nem
 * que a maioria tem mais de uma foto. Portanto:
 *
 * - **na lista, renderize só o índice 0.** Três `<img>` por card num grid de 50
 *   viram ~150 requisições à Caixa saindo do navegador do corretor, a maioria
 *   404, em rajada do mesmo IP — o padrão que faz o bot manager do site
 *   devolver CAPTCHA. Quem levaria o bloqueio é o corretor, e o sintoma dele
 *   seria "as fotos sumiram";
 * - as outras só na tela de **um** imóvel, e ainda assim sob demanda (o usuário
 *   avança na galeria), nunca todas de uma vez;
 * - 404 é normal: esconda a imagem, sem erro na tela e sem nova tentativa.
 */
export const CAIXA_PHOTO_INDEX_LIMIT = 3

/** Só a primeira foto é pedida em lista: uma requisição por imóvel exibido. */
export const CAIXA_GRID_PHOTO_INDEX = 0

function isListingNumber(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,13}$/.test(value)
}

/**
 * URL da foto do imóvel no servidor da Caixa, derivada só do número:
 * `/fotos/F` + número com zeros à esquerda até 13 dígitos + índice + `.jpg`.
 *
 * Devolve `null` quando o número não serve ou o índice está fora da faixa
 * conhecida — a tela trata `null` como "sem foto" em vez de montar uma URL
 * inventada. A imagem é buscada pelo navegador de quem está olhando,
 * diretamente da Caixa: nunca baixamos, copiamos nem guardamos o arquivo.
 */
export function buildCaixaPhotoUrl(numero: string, index = 0): string | null {
  if (!isListingNumber(numero) || !Number.isInteger(index) || index < 0) {
    return null
  }

  if (index >= CAIXA_PHOTO_INDEX_LIMIT) {
    return null
  }

  const padded = numero.padStart(LISTING_NUMBER_LENGTH, "0")

  return `${CAIXA_ORIGIN}/fotos/F${padded}${FIRST_PHOTO_INDEX + index}.jpg`
}

/** Página oficial do imóvel na Caixa — é lá que o corretor confere o resto. */
export function buildCaixaListingUrl(numero: string): string | null {
  return isListingNumber(numero)
    ? `${CAIXA_ORIGIN}/sistema/detalhe-imovel.asp?hdnimovel=${numero}`
    : null
}

/**
 * Só aceita link que aponte para o site da Caixa (o CSV é dado não confiável:
 * a coluna 12 vira `href` na tela).
 */
export function isCaixaUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300) {
    return false
  }

  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.host === "venda-imoveis.caixa.gov.br"
  } catch {
    return false
  }
}

const PHOTOS_OFF_VALUES = new Set(["0", "false", "off", "no", "nao", "não", "desligado"])

/**
 * Interruptor geral das fotos por variável de ambiente: qualquer valor de
 * desligamento apaga **todas** as imagens do módulo de uma vez, sem mudar
 * código. Ausente ou vazio mantém as fotos ligadas.
 */
export function isCaixaPhotosEnabled(rawValue: string | undefined | null): boolean {
  const value = rawValue?.trim().toLowerCase()

  if (!value) {
    return true
  }

  return !PHOTOS_OFF_VALUES.has(value)
}
