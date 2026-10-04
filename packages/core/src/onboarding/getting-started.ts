// "Comece por aqui" do painel: quais passos aparecem e quais já estão feitos,
// calculados a partir de fatos lidos no servidor (contagens e preferências).
// Módulo puro: sem banco, sem React. A ordem dos passos é a ordem sugerida.

export type GettingStartedStepId =
  | "import_spreadsheet"
  | "first_property"
  | "invite_team"
  | "organization_whatsapp"
  | "phone_alerts"
  | "daily_digest"

export type GettingStartedFacts = {
  /** Importações de planilha concluídas (e não desfeitas) nesta imobiliária. */
  finishedImports: number
  /** Imóveis cadastrados (qualquer situação). */
  properties: number
  /** Membros ativos, incluindo quem está vendo. */
  activeMembers: number
  /** Convites ainda válidos, sem aceite. */
  pendingInvitations: number
  /** Telefone ou WhatsApp da imobiliária preenchido. */
  hasOrganizationPhone: boolean
  /**
   * Aparelhos com avisos no celular de quem está vendo. null = avisos no
   * celular indisponíveis nesta instalação (o passo não aparece).
   */
  pushDevices: number | null
  /** Resumo das 7h por e-mail ligado para quem está vendo. */
  dailyDigestEnabled: boolean
}

export type GettingStartedStep = {
  id: GettingStartedStepId
  done: boolean
}

export type GettingStartedProgress = {
  steps: GettingStartedStep[]
  doneCount: number
  total: number
  allDone: boolean
}

function positive(value: number) {
  return Number.isFinite(value) && value > 0
}

export function buildGettingStarted(facts: GettingStartedFacts): GettingStartedProgress {
  const steps: GettingStartedStep[] = [
    { id: "import_spreadsheet", done: positive(facts.finishedImports) },
    { id: "first_property", done: positive(facts.properties) },
    {
      id: "invite_team",
      done: facts.activeMembers > 1 || positive(facts.pendingInvitations),
    },
    { id: "organization_whatsapp", done: facts.hasOrganizationPhone },
  ]

  if (facts.pushDevices !== null) {
    steps.push({ id: "phone_alerts", done: positive(facts.pushDevices) })
  }

  steps.push({ id: "daily_digest", done: facts.dailyDigestEnabled })

  const doneCount = steps.filter((step) => step.done).length

  return { steps, doneCount, total: steps.length, allDone: doneCount === steps.length }
}
