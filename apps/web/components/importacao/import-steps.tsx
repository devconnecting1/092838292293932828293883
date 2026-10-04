import { CheckIcon } from "lucide-react"
import { cn } from "cn"

export const IMPORT_WIZARD_STEPS = [
  { key: "kind", label: "Tipo" },
  { key: "file", label: "Arquivo" },
  { key: "mapping", label: "Colunas" },
  { key: "review", label: "Conferência" },
  { key: "import", label: "Importação" },
] as const

export type ImportWizardStep = (typeof IMPORT_WIZARD_STEPS)[number]["key"]

/** Indicador dos passos: no celular, só o passo atual; da tela média em diante, todos. */
export function ImportSteps({ current }: { current: ImportWizardStep }) {
  const currentIndex = IMPORT_WIZARD_STEPS.findIndex((step) => step.key === current)
  const currentStep = IMPORT_WIZARD_STEPS[currentIndex]

  return (
    <nav aria-label="Passos da importação" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground md:hidden">
        Passo {currentIndex + 1} de {IMPORT_WIZARD_STEPS.length}: {currentStep?.label}
      </p>
      <ol className="flex gap-1 md:gap-2">
        {IMPORT_WIZARD_STEPS.map((step, index) => {
          const done = index < currentIndex
          const active = index === currentIndex

          return (
            <li
              key={step.key}
              aria-current={active ? "step" : undefined}
              className="flex min-w-0 flex-1 flex-col gap-1.5"
            >
              <span className={cn("h-1 rounded-full bg-muted", (done || active) && "bg-primary")} />
              <span
                className={cn(
                  "hidden items-center gap-1 truncate text-xs text-muted-foreground md:flex",
                  active && "font-medium text-foreground"
                )}
              >
                {done ? <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                <span className="sr-only">
                  {done ? "Concluído: " : active ? "Atual: " : "Próximo: "}
                </span>
                {index + 1}. {step.label}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
