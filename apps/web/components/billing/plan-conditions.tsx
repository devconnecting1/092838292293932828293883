import {
  ArrowRightLeftIcon,
  BadgeCheckIcon,
  DownloadIcon,
  ImagesIcon,
  LogOutIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

import { OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT } from "@workspace/core/billing"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

const CONDITIONS: ReadonlyArray<{ icon: LucideIcon; title: string; description: string }> = [
  {
    icon: BadgeCheckIcon,
    title: "Sem fidelidade",
    description: "Sem multa. No anual, se cancelar antes, você perde só o desconto.",
  },
  {
    icon: WrenchIcon,
    title: "Sem taxa de implantação",
    description: "Você começa no mesmo dia, sem cobrança de configuração.",
  },
  {
    icon: ArrowRightLeftIcon,
    title: "Migração grátis",
    description: "Ajudamos a trazer imóveis e clientes do sistema que você usa hoje.",
  },
  {
    icon: LogOutIcon,
    title: "Cancelamento no app",
    description: "Sem ligação nem e-mail. Vale no fim do período que você já pagou.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Garantia de 30 dias",
    description: "Não gostou? Devolvemos o primeiro pagamento inteiro.",
  },
  {
    icon: TrendingUpIcon,
    title: "Reajuste só pelo IPCA",
    description: "No máximo uma vez por ano, sempre com 45 dias de aviso.",
  },
  {
    icon: DownloadIcon,
    title: "Seus dados são seus",
    description: "Leads, imóveis, clientes e propostas em planilha por 90 dias depois de cancelar.",
  },
  {
    // Não é "ilimitado": imóvel com foto hospedada por nós tem o limite do plano.
    icon: ImagesIcon,
    title: "Limite só para imóvel com foto",
    description: `Clientes, condomínios e imóveis sem foto ou só com fotos hospedadas no site de origem não têm limite. Imóveis à venda ou para alugar com fotos hospedadas por nós (inclusive as trazidas por link na importação de planilhas) seguem o limite do plano, que cresce com pacotes de +10 imóveis; ${OWNED_LISTING_RELEASED_STATUS_PLURAL_TEXT} não contam.`,
  },
]

export function PlanConditions() {
  return (
    <ItemGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CONDITIONS.map(({ icon: Icon, title, description }) => (
        <Item key={title} variant="muted" role="listitem" className="items-start">
          <ItemMedia variant="icon">
            <Icon aria-hidden="true" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{title}</ItemTitle>
            <ItemDescription className="line-clamp-none">{description}</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}
