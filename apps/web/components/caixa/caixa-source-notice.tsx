import { ExternalLinkIcon, InfoIcon } from "lucide-react"

import { formatBrDate } from "@workspace/core/caixa/normalize"
import { CAIXA_DOWNLOAD_PAGE_URL, CAIXA_SOURCE_LABEL } from "@workspace/core/caixa/source"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import type { CaixaCatalogStatus } from "@/lib/caixa/list-queries"
import { formatDateTime } from "@/lib/format"

/**
 * Aviso de origem, em toda tela do módulo.
 *
 * O texto diz o que é verdade e só isso: a informação é da Caixa, o que está
 * aqui é uma cópia, ela pode estar desatualizada e a fonte oficial é o site
 * dela. O título mostra a idade do dado pela data que a PRÓPRIA Caixa declara
 * no arquivo ("Lista da Caixa de DD/MM/AAAA"), formatada sem passar por fuso —
 * senão a data de 16/09 apareceria como 15/09 no horário de Brasília. Não
 * promete periodicidade: quem decide quando a lista muda é a Caixa.
 */
export function CaixaSourceNotice({ status }: { status: CaixaCatalogStatus | null }) {
  const generatedOn = formatBrDate(status?.lista_gerada_em)
  const changedAt = status?.last_changed_at ? formatDateTime(status.last_changed_at) : null

  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>
        {generatedOn ? `Lista da Caixa de ${generatedOn}` : `Fonte: ${CAIXA_SOURCE_LABEL}`}
      </AlertTitle>
      <AlertDescription>
        <p>
          {generatedOn ? `Fonte: ${CAIXA_SOURCE_LABEL}. ` : null}Esta é uma cópia da lista pública
          de imóveis que a Caixa vende, e <strong>ela pode estar desatualizada</strong>: valores,
          prazos e a própria disponibilidade mudam no site da Caixa, que é a fonte oficial. Confirme
          lá antes de prometer qualquer coisa a um cliente.
        </p>
        <p className="text-xs">
          {changedAt ? `Nossa cópia foi atualizada em ${changedAt}. ` : null}
          <a
            href={CAIXA_DOWNLOAD_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            Lista oficial da Caixa
            <ExternalLinkIcon className="size-3" />
          </a>
        </p>
      </AlertDescription>
    </Alert>
  )
}
