// Nome de município brasileiro vindo de fontes diferentes. Módulo puro.

/** Chave de comparação: sem acentos, minúsculas e espaços simples. */
function cityKey(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * A Receita Federal (consulta de CNPJ) manda o município em maiúsculas e sem
 * acento ("SAO JOSE DOS CAMPOS"); o CEP da empresa (ViaCEP/BrasilAPI) traz a
 * grafia oficial ("São José dos Campos"). Usa a do CEP quando é o mesmo
 * município; senão fica com o nome da Receita já formatado.
 */
export function pickOfficialCityName(
  fromReceita: string,
  fromPostalCode: string | null | undefined
) {
  const official = fromPostalCode?.trim() ?? ""

  if (official && cityKey(official) === cityKey(fromReceita)) {
    return official
  }

  return fromReceita
}
