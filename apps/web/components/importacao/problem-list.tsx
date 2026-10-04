import { DownloadIcon } from "lucide-react"

import type { ImportRowProblem } from "@workspace/core/import/report"
import { Button } from "@workspace/ui/components/button"

const VISIBLE_PROBLEMS = 100

/** Linhas com motivo, em lista (legível no celular). Mostra as 100 primeiras. */
export function ProblemList({
  problems,
  onDownload,
  downloadLabel = "Baixar CSV com essas linhas",
}: {
  problems: readonly ImportRowProblem[]
  onDownload?: () => void
  downloadLabel?: string
}) {
  if (problems.length === 0) {
    return null
  }

  const hidden = problems.length - VISIBLE_PROBLEMS

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border text-sm">
        {problems.slice(0, VISIBLE_PROBLEMS).map((problem) => (
          <li
            key={`${problem.status}-${problem.line}`}
            className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3"
          >
            <span className="shrink-0 font-medium tabular-nums sm:w-20">Linha {problem.line}</span>
            <span className="text-muted-foreground">{problem.reason}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {hidden > 0
            ? `Mostrando ${VISIBLE_PROBLEMS} de ${problems.length.toLocaleString("pt-BR")} linhas. O arquivo tem todas.`
            : `${problems.length.toLocaleString("pt-BR")} ${problems.length === 1 ? "linha" : "linhas"}.`}
        </p>
        {onDownload ? (
          <Button type="button" variant="outline" onClick={onDownload} className="w-full sm:w-auto">
            <DownloadIcon data-icon="inline-start" />
            {downloadLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
