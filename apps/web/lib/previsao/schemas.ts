import { z } from "zod"

const probabilityField = z
  .number({ error: "Informe um percentual de 0 a 100." })
  .int("Use um número inteiro, sem casas decimais.")
  .min(0, "O percentual não pode ser negativo.")
  .max(100, "O percentual não pode passar de 100%.")

/** Mesmo intervalo do CHECK proposal_stage_probabilities_range (smallint 0..100). */
export const stageProbabilitiesSchema = z.object({
  draft: probabilityField,
  sent: probabilityField,
  countered: probabilityField,
})

export type StageProbabilitiesValues = z.infer<typeof stageProbabilitiesSchema>
