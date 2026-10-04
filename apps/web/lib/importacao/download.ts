import { CSV_CONTENT_TYPE } from "@workspace/core/reports/csv"

/** Baixa um CSV gerado no navegador (modelo de planilha ou lista de erros). */
export function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: CSV_CONTENT_TYPE })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = fileName
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()

  // Dá tempo ao navegador de iniciar o download antes de liberar a memória.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
