type Note = {
  title: string
  description: string
}

/**
 * Dois blocos no rodapé, e só. A versão anterior trazia 6 módulos e 3
 * destaques: informação demais numa tela cujo único trabalho é receber e-mail e
 * senha. Quem chega aqui já decidiu entrar — o painel serve para situar, não
 * para vender de novo.
 */
const NOTES: Note[] = [
  {
    title: "Primeira vez por aqui?",
    description:
      "São 14 dias grátis, sem cartão. A migração dos seus imóveis é assistida e não custa nada.",
  },
  {
    title: "Precisa de ajuda?",
    description: "Suporte humano em português, sem robô no meio. Respondemos no mesmo dia útil.",
  },
]

/** Painel lateral das telas de autenticação. */
export function AuthCover() {
  return (
    <aside className="hidden flex-col justify-between gap-16 border-s bg-muted/40 p-10 lg:flex xl:p-14">
      <div className="flex max-w-md flex-col gap-4">
        <p className="text-sm font-medium text-muted-foreground">
          Espaço de trabalho da imobiliária
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-balance">
          Imóveis, clientes e equipe num só lugar.
        </h2>
        <p className="text-pretty text-muted-foreground">
          Do primeiro contato ao contrato assinado, cada corretor sabe o que precisa fazer hoje.
        </p>
      </div>

      <ul className="grid max-w-2xl gap-8 sm:grid-cols-2">
        {NOTES.map(({ title, description }) => (
          <li key={title} className="flex flex-col gap-1.5 border-s ps-4">
            <p className="text-sm font-medium">{title}</p>
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          </li>
        ))}
      </ul>
    </aside>
  )
}
