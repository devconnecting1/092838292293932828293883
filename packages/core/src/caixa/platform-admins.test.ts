import { describe, expect, it } from "vitest"

import { isPlatformAdminEmail, parsePlatformAdminEmails } from "./platform-admins"

describe("parsePlatformAdminEmails", () => {
  it("separa por vírgula, tira espaços e guarda em minúsculas", () => {
    expect([...parsePlatformAdminEmails(" Ana@Empresa.com.br , bia@empresa.com.br,")]).toEqual([
      "ana@empresa.com.br",
      "bia@empresa.com.br",
    ])
  })

  it("aceita ponto e vírgula e quebra de linha e ignora o que não é e-mail", () => {
    expect([
      ...parsePlatformAdminEmails("ana@empresa.com.br;\nbia@empresa.com.br ; ninguem ; @ ; x@"),
    ]).toEqual(["ana@empresa.com.br", "bia@empresa.com.br"])
  })

  it("variável vazia ou ausente não libera ninguém", () => {
    expect(parsePlatformAdminEmails("").size).toBe(0)
    expect(parsePlatformAdminEmails("  ,  ").size).toBe(0)
    expect(parsePlatformAdminEmails(undefined).size).toBe(0)
    expect(parsePlatformAdminEmails(null).size).toBe(0)
  })
})

describe("isPlatformAdminEmail", () => {
  const LIST = "ana@empresa.com.br, Bia@Empresa.com.br"

  it("libera quem está na lista, sem diferenciar maiúsculas", () => {
    expect(isPlatformAdminEmail("ana@empresa.com.br", LIST)).toBe(true)
    expect(isPlatformAdminEmail("ANA@EMPRESA.COM.BR", LIST)).toBe(true)
    expect(isPlatformAdminEmail(" bia@empresa.com.br ", LIST)).toBe(true)
  })

  it("recusa quem não está na lista", () => {
    expect(isPlatformAdminEmail("carla@empresa.com.br", LIST)).toBe(false)
    // Parecido não é igual: sem prefixo, sufixo ou domínio "quase".
    expect(isPlatformAdminEmail("ana@empresa.com.br.evil", LIST)).toBe(false)
    expect(isPlatformAdminEmail("xana@empresa.com.br", LIST)).toBe(false)
  })

  it("recusa e-mail vazio, ausente ou lista vazia", () => {
    expect(isPlatformAdminEmail("", LIST)).toBe(false)
    expect(isPlatformAdminEmail(null, LIST)).toBe(false)
    expect(isPlatformAdminEmail(undefined, LIST)).toBe(false)
    expect(isPlatformAdminEmail("ana@empresa.com.br", "")).toBe(false)
    expect(isPlatformAdminEmail("ana@empresa.com.br", undefined)).toBe(false)
  })

  it("não deixa uma lista inteira passar como se fosse um e-mail", () => {
    expect(isPlatformAdminEmail("ana@empresa.com.br, bia@empresa.com.br", LIST)).toBe(false)
  })
})
