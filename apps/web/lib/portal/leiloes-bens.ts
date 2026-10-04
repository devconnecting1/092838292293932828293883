/**
 * Guias dos leilões de bens que não são imóveis, escritos para o cliente leigo.
 * Fatos com base legal trazem a fonte em FONTES; o resto é orientação prática e geral,
 * sempre remetendo ao edital de cada leilão.
 */

export type CategoriaBem = "veiculos" | "agro" | "animais" | "diversos"

export type GuiaBem = {
  id: CategoriaBem
  slug: string
  titulo: string
  curto: string
  chamada: string
  intro: string
  quemVende: [string, string][]
  tiposLote: [string, string][]
  passos: { t: string; d: string }[]
  custos: string[]
  cuidados: string[]
  faq: [string, string][]
}

export const FONTES = {
  comissao: {
    rotulo: "Decreto nº 21.981/1932, art. 24, parágrafo único (comissão de 5% paga pelo comprador)",
    url: "https://www.planalto.gov.br/ccivil_03/decreto/1930-1949/d21981.htm",
  },
  isencao: {
    rotulo:
      "Instrução Normativa SRF nº 599/2005, art. 1º (isenção de bens de pequeno valor até R$ 35 mil)",
    url: "https://www.legisweb.com.br/legislacao/?id=76304",
  },
  aliquota: {
    rotulo: "Lei nº 13.259/2016 (alíquota de 15% sobre o ganho de capital até R$ 5 milhões)",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/lei/l13259.htm",
  },
  sanidade: {
    rotulo:
      "Agrodefesa/GO: exigências para animais em eventos agropecuários (exemplo de um estado)",
    url: "https://goias.gov.br/agrodefesa/?p=1373",
  },
}

const PASSOS_BASE = (bem: string) => [
  {
    t: "Escolha do lote",
    d: `Você encontra o ${bem} no site do leiloeiro ou nos manda o link. A gente diz se vale a pena olhar de perto.`,
  },
  {
    t: "Leitura do edital",
    d: "O edital é a regra daquele leilão: quem paga cada débito, a comissão, as taxas, a forma de pagamento e o prazo de retirada. Lemos inteiro, com você.",
  },
  {
    t: "Visita e checagem",
    d: "Sempre que o leiloeiro permitir, alguém vê o bem antes. Conferimos documentos, restrições e processos ligados a ele.",
  },
  {
    t: "Conta completa e lance máximo",
    d: "Somamos lance, comissão, taxas, débitos, frete e regularização. Daí sai o lance máximo: acima dele, o negócio deixa de compensar.",
  },
  {
    t: "Cadastro e lance",
    d: "O cadastro no site do leiloeiro costuma exigir documentos com antecedência. Ajudamos e acompanhamos o pregão com você.",
  },
  {
    t: "Pagamento e retirada",
    d: "Arrematou: paga no prazo do edital, recebe a nota de arrematação e retira o bem. Atraso pode gerar multa, diária ou perda do lote.",
  },
]

export const GUIAS: GuiaBem[] = [
  {
    id: "veiculos",
    slug: "leilao-de-veiculos",
    titulo: "Leilão de veículos",
    curto: "Veículos",
    chamada: "Carro, moto ou caminhão de leilão, com a conta feita antes do lance.",
    intro:
      "Leilão de veículos é a venda pública de carros, motos, caminhões e utilitários por um leiloeiro. O preço costuma ficar abaixo do mercado porque o vendedor quer vender rápido e porque o comprador assume parte do trabalho: retirar, regularizar e, às vezes, consertar. Quem faz a conta direito antes do lance compra bem. Quem não faz, paga caro.",
    quemVende: [
      ["Bancos e financeiras", "Veículos retomados de financiamentos que não foram pagos."],
      [
        "Seguradoras",
        "Veículos indenizados por batida, enchente, roubo ou furto e depois recuperados.",
      ],
      [
        "Empresas e locadoras",
        "Renovação de frota: costumam ter manutenção feita e documentação em dia.",
      ],
      ["Detran e pátios", "Veículos removidos que o dono não buscou no prazo."],
      ["Receita Federal", "Veículos apreendidos em fiscalização."],
      ["Justiça", "Veículos penhorados em processos para pagar dívidas."],
    ],
    tiposLote: [
      [
        "Documentado",
        "Pode voltar a rodar depois da transferência para o seu nome. É o lote de quem quer usar ou revender.",
      ],
      [
        "Sucata ou peças",
        "Não volta a circular. Serve para desmonte e venda de peças. Em muitos leilões, só empresas credenciadas podem comprar.",
      ],
      [
        "Com sinistro",
        "Teve dano registrado. Pode ter restrição no documento e valer menos na revenda. Precisa de atenção redobrada.",
      ],
      [
        "Recuperado de roubo ou furto",
        "Voltou às mãos da seguradora. Confira o histórico e a situação no Detran.",
      ],
    ],
    passos: PASSOS_BASE("veículo"),
    custos: [
      "Lance.",
      "Comissão do leiloeiro: em regra, 5% sobre o lance, pagos pelo comprador. Em leilão judicial, vale o percentual fixado pelo juiz.",
      "Taxa administrativa do leiloeiro, quando o edital prevê.",
      "Diárias do pátio até a retirada e o guincho, se o veículo não puder rodar.",
      "Débitos que o edital deixa com o comprador: multas, IPVA atrasado, licenciamento.",
      "Transferência no Detran, vistoria, placa Mercosul quando necessária e despachante.",
      "IPVA do ano e reparos.",
    ],
    cuidados: [
      "Leia quem paga os débitos: em uns leilões eles são quitados com o valor da venda, em outros ficam com você.",
      "Confirme se o lote é documentado. Sucata não volta a rodar, por mais bonito que esteja.",
      "Veja o veículo antes, se a visitação for permitida. Foto de leilão não mostra defeito.",
      "Calcule o prazo de retirada: cada dia a mais no pátio custa.",
      "Depois de receber os documentos, faça logo a transferência para o seu nome no Detran. O atraso gera multa.",
    ],
    faq: [
      [
        "Carro de leilão vale menos na revenda?",
        "Pode valer, principalmente quando o histórico mostra sinistro. Por isso a calculadora usa o valor de mercado que você informar, não só a FIPE.",
      ],
      [
        "Pago imposto se revender com lucro?",
        "Pessoa física que vende um bem por até R$ 35 mil no mês fica isenta do imposto sobre o lucro. Acima disso, o imposto começa em 15% sobre o lucro. Fale com o seu contador antes.",
      ],
      [
        "Posso financiar o lance?",
        "Normalmente não: o leilão de veículo costuma ser pago à vista, em prazo curto. Confira no edital.",
      ],
    ],
  },
  {
    id: "agro",
    slug: "leilao-agro",
    titulo: "Leilão de máquinas e agro",
    curto: "Agro e máquinas",
    chamada: "Trator, colheitadeira e implemento de leilão, com checagem de uso e de documentos.",
    intro:
      "No leilão agro aparecem tratores, colheitadeiras, plantadeiras, pulverizadores, implementos, caminhões de frota rural e, às vezes, produção e insumos. Vendem bancos, empresas que renovam frota, cooperativas e a Justiça. A máquina certa sai bem abaixo do preço de uma nova, desde que o comprador saiba o quanto ela já trabalhou e quanto vai gastar para trazê-la.",
    quemVende: [
      ["Bancos", "Máquinas retomadas de financiamentos rurais."],
      ["Empresas e cooperativas", "Renovação de frota e de equipamentos."],
      ["Justiça", "Bens penhorados em processos."],
      ["Produtores", "Leilões próprios de fazendas e eventos do setor."],
    ],
    tiposLote: [
      [
        "Máquina autopropelida",
        "Trator, colheitadeira, pulverizador. O horímetro mostra quantas horas trabalhou.",
      ],
      ["Implemento", "Plantadeira, grade, carreta. Não tem motor; avalie o desgaste das peças."],
      ["Veículo rural", "Caminhão, picape. Segue as mesmas regras do leilão de veículos."],
      [
        "Imóvel rural",
        "Fazenda, sítio, terra. Vai pela nossa assessoria de imóveis, com análise da matrícula.",
      ],
    ],
    passos: PASSOS_BASE("bem"),
    custos: [
      "Lance.",
      "Comissão do leiloeiro: em regra, 5% sobre o lance, pagos pelo comprador, ou o que o juiz fixar no leilão judicial.",
      "Taxas do leilão previstas no edital.",
      "Frete com caminhão prancha ou carreta, carga e descarga.",
      "Revisão, peças e pneus.",
      "Documentação e registro, quando o bem tiver.",
    ],
    cuidados: [
      "Peça o horímetro e o histórico de manutenção. Máquina parada há muito tempo também esconde defeito.",
      "Confira se há alienação, penhora ou outra restrição sobre o bem.",
      "Veja a nota fiscal ou o documento de origem: sem ele, revender fica difícil.",
      "Calcule o frete antes. Máquina grande, longe, pode custar caro para chegar.",
      "Confirme o prazo de retirada e quem responde pelo bem até lá.",
    ],
    faq: [
      [
        "Vale mais a pena que uma máquina usada de loja?",
        "Às vezes sim, às vezes não. A loja dá garantia; o leilão vende no estado em que está. A conta completa mostra a diferença real.",
      ],
      [
        "Imóvel rural entra aqui?",
        "Não. Terra e fazenda têm matrícula, ITR e outras exigências. Vão pela assessoria de imóveis de leilão.",
      ],
    ],
  },
  {
    id: "animais",
    slug: "leilao-de-animais",
    titulo: "Leilão de animais",
    curto: "Animais",
    chamada: "Gado, reprodutores e cavalos de leilão, com sanidade e transporte em ordem.",
    intro:
      "Leilão de animais é a venda de gado de corte e de leite, reprodutores, matrizes, cavalos e outros animais em pregão, presencial ou pela internet. É comum o pagamento parcelado, conforme o regulamento de cada leilão. O comprador precisa cuidar de três coisas além do preço: a saúde dos animais, a papelada para transportar e o frete até a propriedade.",
    quemVende: [
      ["Criadores e fazendas", "Leilões de raça, de genética e de descarte."],
      ["Leiloeiras rurais", "Pregões regulares de gado de corte e de reposição."],
      ["Justiça", "Animais penhorados em processos."],
    ],
    tiposLote: [
      ["Gado de corte e de reposição", "Bezerros, garrotes, bois e vacas para engorda ou abate."],
      ["Matrizes e reprodutores", "Animais de genética, com registro e histórico."],
      ["Gado de leite", "Vacas e novilhas, com dados de produção quando informados."],
      ["Equinos e outros", "Cavalos, ovinos, caprinos e outras criações."],
    ],
    passos: [
      ...PASSOS_BASE("animal").slice(0, 2),
      {
        t: "Sanidade e documentos",
        d: "Para transportar, os animais precisam da Guia de Trânsito Animal (GTA) e dos exames e vacinas que o órgão de defesa do estado exige. Conferimos isso antes do lance.",
      },
      ...PASSOS_BASE("animal").slice(3),
    ],
    custos: [
      "Lance, normalmente por cabeça ou por lote.",
      "Comissão do leiloeiro, conforme o regulamento do leilão.",
      "Parcelas, quando o leilão parcela: some todas para ver o custo real.",
      "Frete em caminhão boiadeiro ou apropriado.",
      "Exames, vacinas e emissão da GTA quando ficam com o comprador.",
      "Quarentena, alimentação e manejo na chegada.",
    ],
    cuidados: [
      "Peça os exames e atestados sanitários exigidos pelo órgão de defesa do seu estado. Cada estado tem regras próprias.",
      "Sem GTA, o animal não pode ser transportado.",
      "Confira se o regulamento diz até quando o vendedor responde pelo animal.",
      "No parcelamento, leia as garantias pedidas e o que acontece se uma parcela atrasar.",
      "Planeje o frete e a chegada: estresse de viagem causa perda de peso e doença.",
    ],
    faq: [
      [
        "O que é a GTA?",
        "É a Guia de Trânsito Animal, documento obrigatório para levar os animais de um lugar para outro. Ela depende de os animais estarem com a sanidade em dia.",
      ],
      [
        "Quais exames são pedidos?",
        "Depende do estado e da espécie. Em Goiás, por exemplo, a Agrodefesa pede para bovinos exames de brucelose e tuberculose; para cavalos, de anemia infecciosa equina e vacina de influenza. Conferimos as regras do seu estado.",
      ],
    ],
  },
  {
    id: "diversos",
    slug: "leilao-de-outros-bens",
    titulo: "Leilão de outros bens",
    curto: "Outros bens",
    chamada:
      "Equipamentos, embarcações e bens de empresas e da Justiça, com a conta antes do lance.",
    intro:
      "Além de imóveis, veículos, máquinas e animais, vão a leilão equipamentos de empresas, eletrônicos, móveis, embarcações e bens penhorados pela Justiça. A regra de ouro é a mesma: o bem é vendido no estado em que está, e quem compra precisa saber o custo total antes de dar o lance.",
    quemVende: [
      ["Empresas", "Encerramento de atividade, troca de equipamentos e estoque."],
      ["Órgãos públicos", "Bens que não são mais usados."],
      ["Justiça", "Bens penhorados e de massas falidas."],
    ],
    tiposLote: [
      ["Equipamentos e máquinas", "Industriais, de escritório, de construção."],
      ["Embarcações", "Lanchas e barcos, com documentação própria na Marinha."],
      ["Lotes mistos", "Vários itens juntos, comuns em falências e desocupações."],
    ],
    passos: PASSOS_BASE("bem"),
    custos: [
      "Lance.",
      "Comissão do leiloeiro: em regra, 5% sobre o lance, pagos pelo comprador, ou o que o juiz fixar no leilão judicial.",
      "Taxas do leilão.",
      "Retirada, desmontagem e frete.",
      "Documentação e registro, quando o bem tiver.",
    ],
    cuidados: [
      "Leia a descrição do lote com lupa: o bem é vendido no estado em que está.",
      "Veja o prazo de retirada e quem paga a desmontagem.",
      "Confira se há documentação para registrar ou revender.",
    ],
    faq: [
      [
        "Posso devolver se não gostar?",
        "Em regra, não. Por isso a visita e a leitura do edital vêm antes do lance.",
      ],
    ],
  },
]

export const guiaPorSlug = (slug: string) => GUIAS.find((g) => g.slug === slug) ?? null
