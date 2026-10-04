"use client"

import * as React from "react"
import Link from "next/link"

const campo = "h-11 rounded-lg border border-slate-300 px-3"

/** Dois telefones, cada um com a marcação "é WhatsApp" (senão é telefone de recado). */
export function TelefonesCampos({
  inicial,
}: {
  inicial?: { t1?: string | null; w1?: boolean | null; t2?: string | null; w2?: boolean | null }
}) {
  const linha = (n: 1 | 2, tel?: string | null, wa?: boolean | null) => (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <input
        name={`telefone_${n}`}
        required
        inputMode="tel"
        defaultValue={tel ?? ""}
        placeholder={`Telefone ${n} com DDD`}
        className={campo}
      />
      <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-semibold">
        <input
          type="checkbox"
          name={`telefone_${n}_whats`}
          defaultChecked={wa ?? n === 1}
          className="size-4"
        />
        WhatsApp
      </label>
    </div>
  )
  return (
    <div className="flex flex-col gap-2">
      {linha(1, inicial?.t1, inicial?.w1)}
      {linha(2, inicial?.t2, inicial?.w2)}
      <p className="text-xs text-slate-500">
        Marque &quot;WhatsApp&quot; no número que tem WhatsApp. O outro fica como telefone para
        recado.
      </p>
    </div>
  )
}

export function lerTelefones(fd: FormData) {
  const t = (k: string) => String(fd.get(k) ?? "").trim()
  const w = (k: string) => fd.get(k) === "on"
  const t1 = t("telefone_1")
  const t2 = t("telefone_2")
  const w1 = w("telefone_1_whats")
  const w2 = w("telefone_2_whats")
  return {
    telefone_1: t1 || null,
    telefone_1_whats: w1,
    telefone_2: t2 || null,
    telefone_2_whats: w2,
    whatsapp: (w1 ? t1 : w2 ? t2 : t1) || null,
  }
}

/** Resumo da LGPD para ler antes de aceitar; o aceite fica registrado com data e hora. */
export function LgpdAceite({ documentos = true }: { documentos?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
        <b>Como tratamos os seus dados (LGPD)</b>
        <p className="mt-1">
          Usamos o seu nome, telefones, e-mail e endereço para criar a sua conta, falar com você e
          prestar os serviços do portal.{" "}
          {documentos
            ? "Foto e documento de identidade servem só para confirmar que você é você e proteger todos os participantes contra fraude. "
            : ""}
          Documentos ficam em área privada, vistos só pela equipe de aprovação. Não vendemos nem
          repassamos os seus dados a terceiros fora do que o serviço exige (por exemplo, pagamento e
          envio de e-mail). Você pode pedir acesso, correção ou exclusão a qualquer momento pelo
          0800 543 1000 ou pelo suporte. Guardamos registros de acesso e de ações no sistema para a
          sua segurança e para cumprir a lei.
        </p>
      </div>
      <label className="block text-xs leading-relaxed text-slate-700">
        <input type="checkbox" name="lgpd" required className="mr-2 inline size-4 align-[-3px]" />
        Li e aceito o tratamento dos meus dados e a{" "}
        <Link href="/privacidade" target="_blank" className="font-bold underline">
          Política de Privacidade
        </Link>
        .
      </label>
    </div>
  )
}

type Endereco = { cep: string; endereco: string; bairro: string; cidade: string; uf: string }

/** Endereço com busca automática pelo CEP (ViaCEP). */
export function EnderecoCampos({
  inicial,
}: {
  inicial?: Partial<Endereco> & { numero?: string | null; complemento?: string | null }
}) {
  const [e, setE] = React.useState<Endereco>({
    cep: inicial?.cep ?? "",
    endereco: inicial?.endereco ?? "",
    bairro: inicial?.bairro ?? "",
    cidade: inicial?.cidade ?? "",
    uf: inicial?.uf ?? "",
  })
  const [buscando, setBuscando] = React.useState(false)
  const [aviso, setAviso] = React.useState("")

  async function buscar(cep: string) {
    const d = cep.replace(/\D/g, "")
    if (d.length !== 8) return
    setBuscando(true)
    setAviso("")
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const j = (await r.json()) as {
        erro?: boolean
        logradouro?: string
        bairro?: string
        localidade?: string
        uf?: string
      }
      if (j.erro) setAviso("CEP não encontrado. Preencha à mão.")
      else
        setE((x) => ({
          ...x,
          endereco: j.logradouro || x.endereco,
          bairro: j.bairro || x.bairro,
          cidade: j.localidade || x.cidade,
          uf: j.uf || x.uf,
        }))
    } catch {
      setAviso("Não deu para buscar o CEP agora. Preencha à mão.")
    } finally {
      setBuscando(false)
    }
  }

  const set = (k: keyof Endereco) => (ev: React.ChangeEvent<HTMLInputElement>) =>
    setE((x) => ({ ...x, [k]: ev.target.value }))

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input
        name="cep"
        required
        inputMode="numeric"
        value={e.cep}
        onChange={(ev) => {
          set("cep")(ev)
          void buscar(ev.target.value)
        }}
        placeholder="CEP"
        className={campo}
      />
      <span className="self-center text-xs text-slate-500">
        {buscando
          ? "Buscando o endereço..."
          : aviso || "Digite o CEP e o endereço aparece sozinho."}
      </span>
      <input
        name="endereco"
        required
        value={e.endereco}
        onChange={set("endereco")}
        placeholder="Rua"
        className={`${campo} sm:col-span-2`}
      />
      <input
        name="numero"
        required
        defaultValue={inicial?.numero ?? ""}
        placeholder="Número"
        className={campo}
      />
      <input
        name="complemento"
        defaultValue={inicial?.complemento ?? ""}
        placeholder="Complemento"
        className={campo}
      />
      <input
        name="bairro"
        required
        value={e.bairro}
        onChange={set("bairro")}
        placeholder="Bairro"
        className={campo}
      />
      <input
        name="cidade"
        required
        value={e.cidade}
        onChange={set("cidade")}
        placeholder="Cidade"
        className={campo}
      />
      <input
        name="uf"
        required
        maxLength={2}
        value={e.uf}
        onChange={(ev) => setE((x) => ({ ...x, uf: ev.target.value.toUpperCase() }))}
        placeholder="UF"
        className={campo}
      />
    </div>
  )
}
