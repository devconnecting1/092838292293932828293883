import { GaugeIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"

import { getScoreBand, SCORE_BAND_LABELS, type ScoreBand } from "@/lib/imoveis/mappers"

const BAND_VARIANTS: Record<ScoreBand, "default" | "secondary" | "destructive" | "outline"> = {
  high: "default",
  medium: "secondary",
  low: "destructive",
  none: "outline",
}

/**
 * Nota do Anúncio (coluna imob_score) com cor semântica por faixa
 * (≥ 80 ótimo, 50–79 regular, < 50 fraco).
 */
export function ImobScoreBadge({
  score,
  showLabel = false,
  showName = false,
}: {
  score: number | null | undefined
  showLabel?: boolean
  /** Mostra o prefixo "Nota do Anúncio:" (senão ele fica só para leitores de tela). */
  showName?: boolean
}) {
  const band = getScoreBand(score)
  const value = score == null ? "sem nota" : `${score}/100 · ${SCORE_BAND_LABELS[band]}`

  return (
    <Badge variant={BAND_VARIANTS[band]} title={`Nota do Anúncio: ${value}`}>
      <GaugeIcon data-icon="inline-start" />
      <span className={showName ? undefined : "sr-only"}>Nota do Anúncio:</span>
      <span className="tabular-nums">{score == null ? "Sem nota" : `${score}/100`}</span>
      {showLabel && score != null ? <span>· {SCORE_BAND_LABELS[band]}</span> : null}
    </Badge>
  )
}
