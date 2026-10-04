import { EyeIcon } from "lucide-react"

import { PLATFORM_READ_ONLY_MESSAGE } from "@workspace/core/platform/staff"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

/** Id para `aria-describedby` dos botões desabilitados da página. */
export const PLATFORM_READ_ONLY_NOTICE_ID = "console-somente-leitura"

/**
 * Aviso no topo das telas do console para quem é "Somente leitura": explica por
 * que os botões de ação estão desabilitados. O servidor recusa a ação de
 * qualquer jeito; isto é só para a pessoa entender. Use uma vez por página.
 */
export function PlatformReadOnlyNotice() {
  return (
    <Alert id={PLATFORM_READ_ONLY_NOTICE_ID}>
      <EyeIcon />
      <AlertTitle>Acesso somente leitura</AlertTitle>
      <AlertDescription>
        {PLATFORM_READ_ONLY_MESSAGE} Se precisar agir, peça ao Dono da plataforma para mudar o seu
        papel.
      </AlertDescription>
    </Alert>
  )
}
