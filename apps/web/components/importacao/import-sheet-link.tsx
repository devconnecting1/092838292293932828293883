import Link from "next/link"
import { FileSpreadsheetIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { IMPORT_SETTINGS_PATH } from "@/lib/importacao/constants"

/** Atalho "Importar planilha" para os estados vazios das listas (a página confere o papel). */
export function ImportSheetLink() {
  return (
    <Button variant="outline" render={<Link href={IMPORT_SETTINGS_PATH} />} nativeButton={false}>
      <FileSpreadsheetIcon data-icon="inline-start" />
      Importar planilha
    </Button>
  )
}
