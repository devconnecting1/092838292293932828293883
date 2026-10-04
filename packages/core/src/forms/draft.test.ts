import { describe, expect, it } from "vitest"

import {
  buildFormDraftKey,
  FORM_DRAFT_CPF_PLACEHOLDER,
  FORM_DRAFT_KEY_PREFIX,
  FORM_DRAFT_MAX_AGE_MS,
  FORM_DRAFT_MAX_CHARS,
  formatFormDraftSavedAt,
  hasDraftableChanges,
  isFormDraftExpired,
  isSensitiveDraftField,
  listStaleFormDraftKeys,
  maskFullCpfs,
  mergeFormDraftValues,
  parseFormDraft,
  sanitizeDraftValues,
  serializeFormDraft,
} from "./draft"

const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const ORG_ID = "550e8400-e29b-41d4-a716-446655440000"
const RECORD_ID = "9b2f3c1e-8f5d-4a1b-9c2d-3e4f5a6b7c8d"
// CPFs de exemplo com dígitos verificadores válidos.
const CPF = "529.982.247-25"
const CPF_DIGITS = "52998224725"

const NOW = new Date("2026-09-16T17:05:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000

describe("buildFormDraftKey", () => {
  it("separa por usuário, imobiliária, formulário e registro", () => {
    expect(
      buildFormDraftKey({
        userId: USER_ID,
        organizationId: ORG_ID,
        formId: "imovel",
        recordId: RECORD_ID,
      })
    ).toBe(`${FORM_DRAFT_KEY_PREFIX}${USER_ID}:${ORG_ID}:imovel:${RECORD_ID}`)
  })

  it("usa 'novo' para cadastro sem registro", () => {
    const key = buildFormDraftKey({ userId: USER_ID, organizationId: ORG_ID, formId: "cliente" })
    expect(key).toBe(`${FORM_DRAFT_KEY_PREFIX}${USER_ID}:${ORG_ID}:cliente:novo`)
    expect(
      buildFormDraftKey({
        userId: USER_ID,
        organizationId: ORG_ID,
        formId: "cliente",
        recordId: null,
      })
    ).toBe(key)
  })

  it("recusa pedaços vazios ou com separador (sem chave, sem rascunho)", () => {
    expect(buildFormDraftKey({ userId: "", organizationId: ORG_ID, formId: "lead" })).toBeNull()
    expect(buildFormDraftKey({ userId: USER_ID, organizationId: "", formId: "lead" })).toBeNull()
    expect(
      buildFormDraftKey({ userId: `${USER_ID}:x`, organizationId: ORG_ID, formId: "lead" })
    ).toBeNull()
    expect(
      buildFormDraftKey({ userId: USER_ID, organizationId: ORG_ID, formId: "../lead" })
    ).toBeNull()
  })
})

describe("isSensitiveDraftField", () => {
  it("marca CPF, RG, documentos, senhas e tokens", () => {
    for (const key of [
      "cpf",
      "ownerCpf",
      "cpf_cnpj",
      "cnpj",
      "rg",
      "ownerRG",
      "RGNumber",
      "document",
      "documentNumber",
      "documentos",
      "password",
      "newPassword",
      "confirm_password",
      "senha",
      "senhaAtual",
      "accessToken",
      "cardNumber",
      "cvv",
    ]) {
      expect(isSensitiveDraftField(key), key).toBe(true)
    }
  })

  it("não confunde campos comuns com siglas sensíveis", () => {
    for (const key of [
      "name",
      "organization",
      "largeArea",
      "charge",
      "description",
      "birthDate",
      "phone",
      "email",
      "paymentTerms",
      "features",
      "pinned",
    ]) {
      expect(isSensitiveDraftField(key), key).toBe(false)
    }
  })
})

describe("maskFullCpfs", () => {
  it("omite CPF completo e válido dentro de texto livre", () => {
    expect(maskFullCpfs(`Cliente com CPF ${CPF}, ligar à tarde`)).toBe(
      `Cliente com CPF ${FORM_DRAFT_CPF_PLACEHOLDER}, ligar à tarde`
    )
    expect(maskFullCpfs(`cpf:${CPF_DIGITS}.`)).toBe(`cpf:${FORM_DRAFT_CPF_PLACEHOLDER}.`)
  })

  it("mantém números que não são CPF válido ou fazem parte de outro número", () => {
    expect(maskFullCpfs("Valor 123.456.789-00 e código 12345678901")).toBe(
      "Valor 123.456.789-00 e código 12345678901"
    )
    expect(maskFullCpfs(`protocolo ${CPF_DIGITS}9`)).toBe(`protocolo ${CPF_DIGITS}9`)
    expect(maskFullCpfs("(11) 98765-4321")).toBe("(11) 98765-4321")
  })
})

describe("sanitizeDraftValues", () => {
  it("nunca guarda campos sensíveis, nem aninhados", () => {
    const sanitized = sanitizeDraftValues({
      name: "Maria da Silva",
      document: CPF,
      rg: "12.345.678-9",
      password: "segredo123",
      owner: { name: "João", cpf: CPF, rgIssuer: "SSP" },
      tags: ["vip"],
    })

    expect(sanitized).toEqual({
      name: "Maria da Silva",
      owner: { name: "João" },
      tags: ["vip"],
    })
  })

  it("descarta campo cujo valor inteiro é um CPF e omite CPF em texto", () => {
    const sanitized = sanitizeDraftValues({
      observacao: CPF,
      notes: `Documento ${CPF} conferido`,
      phone: "(11) 98765-4321",
      tags: [CPF_DIGITS, "investidor"],
    })

    expect(sanitized).toEqual({
      notes: `Documento ${FORM_DRAFT_CPF_PLACEHOLDER} conferido`,
      phone: "(11) 98765-4321",
      tags: ["investidor"],
    })
  })

  it("respeita a lista extra de exclusão (nome ou caminho)", () => {
    expect(
      sanitizeDraftValues(
        { birthDate: "1990-01-01", address: { street: "Rua A", number: "10" }, city: "Recife" },
        { exclude: ["birthDate", "address.number"] }
      )
    ).toEqual({ address: { street: "Rua A" }, city: "Recife" })
  })

  it("só guarda JSON: sem funções, datas, arquivos, NaN ou referências circulares", () => {
    const circular: Record<string, unknown> = { label: "a" }
    circular.self = circular

    const sanitized = sanitizeDraftValues({
      title: "Apartamento",
      count: 3,
      ratio: Number.NaN,
      infinite: Number.POSITIVE_INFINITY,
      when: new Date(),
      onChange: () => undefined,
      missing: undefined,
      file: new Map(),
      nothing: null,
      circular,
      furnished: false,
    })

    expect(sanitized).toEqual({
      title: "Apartamento",
      count: 3,
      nothing: null,
      circular: { label: "a" },
      furnished: false,
    })
  })

  it("ignora chaves que poderiam poluir o protótipo", () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "title": "ok"}') as unknown
    const sanitized = sanitizeDraftValues(hostile)

    expect(sanitized).toEqual({ title: "ok" })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("devolve objeto vazio para entrada que não é objeto", () => {
    expect(sanitizeDraftValues(null)).toEqual({})
    expect(sanitizeDraftValues("texto")).toEqual({})
    expect(sanitizeDraftValues(["a"])).toEqual({})
  })
})

describe("serializeFormDraft / parseFormDraft", () => {
  it("ida e volta preserva os valores e a hora do salvamento", () => {
    const raw = serializeFormDraft(
      { title: "Casa", bedrooms: "3", features: ["piscina"], furnished: true, property: null },
      NOW
    )

    expect(raw).not.toBeNull()
    const draft = parseFormDraft(raw, new Date(NOW.getTime() + 60_000))

    expect(draft?.savedAt.toISOString()).toBe(NOW.toISOString())
    expect(draft?.values).toEqual({
      title: "Casa",
      bedrooms: "3",
      features: ["piscina"],
      furnished: true,
      property: null,
    })
  })

  it("o JSON gravado não contém dado sensível", () => {
    const raw = serializeFormDraft(
      { name: "Maria", document: CPF, rg: "12.345.678-9", notes: `CPF ${CPF}` },
      NOW
    )

    expect(raw).not.toContain(CPF)
    expect(raw).not.toContain(CPF_DIGITS)
    expect(raw).not.toContain("12.345.678-9")
    expect(raw).not.toContain('"document"')
    expect(raw).not.toContain('"rg"')
  })

  it("não grava quando só há campo sensível ou quando passa do tamanho máximo", () => {
    expect(serializeFormDraft({ cpf: CPF, password: "x" }, NOW)).toBeNull()
    expect(serializeFormDraft({}, NOW)).toBeNull()
    expect(serializeFormDraft({ notes: "a".repeat(FORM_DRAFT_MAX_CHARS) }, NOW)).toBeNull()
  })

  it("vence em 7 dias", () => {
    const raw = serializeFormDraft({ title: "Casa" }, NOW)

    expect(parseFormDraft(raw, new Date(NOW.getTime() + FORM_DRAFT_MAX_AGE_MS))).not.toBeNull()
    expect(parseFormDraft(raw, new Date(NOW.getTime() + FORM_DRAFT_MAX_AGE_MS + 1))).toBeNull()
    expect(parseFormDraft(raw, new Date(NOW.getTime() + 8 * DAY_MS))).toBeNull()
  })

  it("descarta rascunho com data muito no futuro (relógio ou valor adulterado)", () => {
    const raw = serializeFormDraft({ title: "Casa" }, new Date(NOW.getTime() + 2 * DAY_MS))
    expect(parseFormDraft(raw, NOW)).toBeNull()

    const nearFuture = serializeFormDraft({ title: "Casa" }, new Date(NOW.getTime() + 60_000))
    expect(parseFormDraft(nearFuture, NOW)).not.toBeNull()
  })

  it("descarta JSON corrompido, de outra versão ou com formato inesperado", () => {
    expect(parseFormDraft(null, NOW)).toBeNull()
    expect(parseFormDraft("", NOW)).toBeNull()
    expect(parseFormDraft("{quebrado", NOW)).toBeNull()
    expect(parseFormDraft("[]", NOW)).toBeNull()
    expect(
      parseFormDraft(JSON.stringify({ v: 2, savedAt: NOW.toISOString(), values: { a: "b" } }), NOW)
    ).toBeNull()
    expect(
      parseFormDraft(JSON.stringify({ v: 1, savedAt: "ontem", values: { a: "b" } }), NOW)
    ).toBeNull()
    expect(
      parseFormDraft(JSON.stringify({ v: 1, savedAt: NOW.toISOString(), values: "x" }), NOW)
    ).toBeNull()
  })

  it("limpa de novo ao ler: rascunho antigo com campo sensível não o devolve", () => {
    const legacy = JSON.stringify({
      v: 1,
      savedAt: NOW.toISOString(),
      values: { name: "Maria", cpf: CPF, notes: `CPF ${CPF}` },
    })

    expect(parseFormDraft(legacy, NOW)?.values).toEqual({
      name: "Maria",
      notes: `CPF ${FORM_DRAFT_CPF_PLACEHOLDER}`,
    })
  })

  it("isFormDraftExpired trata data inválida como vencida", () => {
    expect(isFormDraftExpired(new Date("x"), NOW)).toBe(true)
    expect(isFormDraftExpired(NOW, NOW)).toBe(false)
  })
})

describe("listStaleFormDraftKeys", () => {
  it("lista só rascunhos vencidos ou inválidos, sem tocar em outras chaves", () => {
    const fresh = serializeFormDraft({ title: "Casa" }, NOW)
    const old = serializeFormDraft({ title: "Casa" }, new Date(NOW.getTime() - 8 * DAY_MS))

    const stale = listStaleFormDraftKeys(
      [
        [`${FORM_DRAFT_KEY_PREFIX}a:b:imovel:novo`, fresh],
        [`${FORM_DRAFT_KEY_PREFIX}a:b:cliente:novo`, old],
        [`${FORM_DRAFT_KEY_PREFIX}a:b:lead:novo`, "{quebrado"],
        ["sidebar_state", "true"],
        ["outra-chave", old],
      ],
      NOW
    )

    expect(stale).toEqual([
      `${FORM_DRAFT_KEY_PREFIX}a:b:cliente:novo`,
      `${FORM_DRAFT_KEY_PREFIX}a:b:lead:novo`,
    ])
  })
})

describe("hasDraftableChanges", () => {
  const base = { name: "", document: "", tags: [] as string[], kind: "pf" }

  it("detecta mudança em campo guardável, sem depender da ordem das chaves", () => {
    expect(hasDraftableChanges({ ...base, name: "Maria" }, base)).toBe(true)
    expect(hasDraftableChanges({ kind: "pf", tags: [], document: "", name: "" }, base)).toBe(false)
  })

  it("ignora mudança só em campo sensível", () => {
    expect(hasDraftableChanges({ ...base, document: CPF }, base)).toBe(false)
  })
})

describe("mergeFormDraftValues", () => {
  const base = {
    title: "",
    bedrooms: "",
    furnished: false,
    features: [] as string[],
    document: "123",
    property: null as { id: string; label: string } | null,
    address: { street: "", city: "Recife" },
  }

  it("aplica os campos do rascunho que existem e têm o mesmo tipo", () => {
    const merged = mergeFormDraftValues(base, {
      title: "Casa na praia",
      bedrooms: 3,
      furnished: true,
      features: ["piscina", "churrasqueira"],
      property: { id: "abc", label: "AP-01" },
      address: { street: "Rua A", city: 10 },
      removedField: "sumiu do formulário",
    })

    expect(merged).toEqual({
      title: "Casa na praia",
      bedrooms: "",
      furnished: true,
      features: ["piscina", "churrasqueira"],
      document: "123",
      property: { id: "abc", label: "AP-01" },
      address: { street: "Rua A", city: "Recife" },
    })
    expect(merged).not.toHaveProperty("removedField")
  })

  it("não sobrescreve campo sensível nem excluído, mesmo se vier no rascunho", () => {
    const merged = mergeFormDraftValues(
      base,
      { document: "999", title: "Casa", bedrooms: "2" },
      { exclude: ["bedrooms"] }
    )

    expect(merged.document).toBe("123")
    expect(merged.bedrooms).toBe("")
    expect(merged.title).toBe("Casa")
  })

  it("recusa lista com tipos misturados ou com objetos", () => {
    expect(mergeFormDraftValues(base, { features: ["a", 1] }).features).toEqual([])
    expect(mergeFormDraftValues(base, { features: [{ a: "b" }] }).features).toEqual([])
    expect(
      mergeFormDraftValues({ ...base, features: ["x"] }, { features: [true] }).features
    ).toEqual(["x"])
  })

  it("não altera o objeto base", () => {
    const original = { title: "", tags: ["a"] }
    const merged = mergeFormDraftValues(original, { title: "Novo", tags: ["b"] })

    expect(original).toEqual({ title: "", tags: ["a"] })
    expect(merged).toEqual({ title: "Novo", tags: ["b"] })
  })
})

describe("formatFormDraftSavedAt", () => {
  it("mostra dia/mês e hora no fuso de Brasília", () => {
    expect(formatFormDraftSavedAt(NOW)).toBe("16/09 às 14:05")
    expect(formatFormDraftSavedAt(new Date("2026-01-02T03:04:00.000Z"))).toBe("02/01 às 00:04")
  })

  it("aceita outro fuso", () => {
    expect(formatFormDraftSavedAt(NOW, "UTC")).toBe("16/09 às 17:05")
  })
})
