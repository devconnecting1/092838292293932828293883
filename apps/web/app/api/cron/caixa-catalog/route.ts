import { checkCronAuthorization, cronReply } from "@/lib/lembretes/cron-auth"
import { runCaixaUploadReminder } from "@/lib/plataforma/caixa-reminder"

/**
 * Rotina diária do catálogo da Caixa (Vercel Cron `7 8 * * *` = 05h07 de
 * Brasília). **Não baixa mais nada do site da Caixa.**
 *
 * O download automático do `Lista_imoveis_geral.csv` recebe 403: o site da
 * Caixa usa proteção anti-robô, que redireciona a requisição para um desafio.
 * Contornar isso (fingir navegador, resolver o desafio, proxy, navegador
 * automatizado ou serviço de terceiros) está fora de questão. O catálogo agora
 * é carregado por **envio manual**: uma pessoa da equipe da plataforma baixa a
 * lista oficial no navegador
 * (https://venda-imoveis.caixa.gov.br/sistema/download-lista.asp) e envia o
 * arquivo em `/plataforma/caixa` (ou pelo comando local `npm run
 * caixa:importar`), com a mesma leitura e gravação de antes
 * (`runCaixaCatalogImport` em lib/caixa/ingest.ts).
 *
 * Para esse envio não depender de memória, esta rota virou um LEMBRETE: quando
 * a última carga tem mais de 24 horas, manda um e-mail a cada endereço de
 * PLATFORM_ADMIN_EMAILS com o link da página oficial de download e o de
 * /plataforma/caixa. Sem nenhuma carga anterior, não envia.
 *
 * Autorização: `Authorization: Bearer ${CRON_SECRET}` (comparação em tempo
 * constante). Resposta e logs só com contagens — nenhum e-mail nem dado de
 * imóvel.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const denied = checkCronAuthorization(request)

  if (denied) {
    return denied
  }

  const summary = await runCaixaUploadReminder()

  if (summary.status === "enviado" || summary.status === "falhou") {
    console.log(
      `[caixa/lembrete] ${summary.status}: ${summary.sent} enviados, ${summary.failed} com falha` +
        (summary.ageHours != null ? ` (última carga há ${summary.ageHours} h)` : "")
    )
  } else if (summary.status !== "em_dia") {
    console.warn(`[caixa/lembrete] sem envio (${summary.status})`)
  }

  // 200 mesmo sem envio: não é falha da rotina, e o motivo vai no corpo.
  return cronReply(200, {
    ok: summary.status !== "falhou" && summary.status !== "estado_indisponivel",
    download: "download_automatico_bloqueado",
    reminder: summary.status,
    recipients: summary.recipients,
    sent: summary.sent,
    failed: summary.failed,
  })
}
