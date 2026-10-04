// Importa imóveis de leilão de parceiros (leilaoimovel, Superbid, leiloeiros) para a tabela `imoveis`.
//
// Não faz raspagem de site: recebe os dados que o parceiro entrega, por envio direto (POST com JSON ou CSV)
// ou por um link de dados que o parceiro libera (config_privado: feed_<fonte>_url).
// Cada imóvel é classificado pela origem (banco, judicial, extrajudicial) e guarda leiloeiro, códigos,
// datas e edital. Imóvel da Caixa que já existe pela lista oficial é só enriquecido, nunca duplicado.
// Com "completo": true, o que o parceiro tirou da lista sai do portal (ativo = false).
//
// Formato dos campos: ver supabase/portal/FEED.md.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-import-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));
const FONTE = /^[a-z0-9_]{3,30}$/;
// Mesmas chaves da tabela public.origens.
const ORIGENS = new Set([
  "caixa", "banco-do-brasil", "itau", "bradesco", "santander", "safra", "inter", "pan", "bv", "brb",
  "sicoob", "porto-bank", "judicial", "extrajudicial", "outros",
]);

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const slug = (s: string) => semAcento(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const txt = (v: unknown, max = 500) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[R$\s]/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const bool = (v: unknown) => {
  if (typeof v === "boolean") return v;
  const s = semAcento(String(v ?? ""));
  if (!s) return null;
  return /^(s|sim|true|1|yes)/.test(s);
};
const data = (v: unknown) => {
  const s = txt(v, 40);
  if (!s) return null;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:as\s+|às\s+)?(\d{2}):(\d{2}))?/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}T${br[4] ?? "12"}:${br[5] ?? "00"}:00-03:00` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const url = (v: unknown) => {
  const s = txt(v, 1000);
  return s && /^https:\/\//i.test(s) ? s : null;
};

/** Origem pelo nome que o parceiro usa ("Itaú Unibanco", "Caixa Econômica Federal", "TJRJ"...). */
export function origemDe(...nomes: unknown[]): string {
  const s = semAcento(nomes.filter(Boolean).join(" "));
  if (!s) return "outros";
  if (/caixa|cef\b/.test(s)) return "caixa";
  if (/banco do brasil|\bbb\b/.test(s)) return "banco-do-brasil";
  if (/itau/.test(s)) return "itau";
  if (/bradesco/.test(s)) return "bradesco";
  if (/santander/.test(s)) return "santander";
  if (/safra/.test(s)) return "safra";
  if (/banco inter\b|\binter\b/.test(s)) return "inter";
  if (/\bpan\b/.test(s)) return "pan";
  if (/\bbv\b|votorantim/.test(s)) return "bv";
  if (/\bbrb\b|banco de brasilia/.test(s)) return "brb";
  if (/sicoob/.test(s)) return "sicoob";
  if (/porto/.test(s)) return "porto-bank";
  if (/extrajudicial|alienacao fiduciaria/.test(s)) return "extrajudicial";
  if (/judicial|\btj[a-z]{2}\b|\btrt|\btrf|vara|tribunal/.test(s)) return "judicial";
  return "outros";
}

function lerCsv(texto: string): Record<string, string>[] {
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) return [];
  const sep = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const campos = (l: string) => {
    const out: string[] = [];
    let atual = "", aspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (aspas && l[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
      else if (c === sep && !aspas) { out.push(atual); atual = ""; }
      else atual += c;
    }
    out.push(atual);
    return out;
  };
  const cab = campos(linhas[0]).map((c) => slug(c).replace(/-/g, "_"));
  return linhas.slice(1).map((l) => {
    const v = campos(l);
    return Object.fromEntries(cab.map((c, i) => [c, (v[i] ?? "").trim()]));
  });
}

type Normal = Record<string, unknown> & { id: string; origem: string; codigo_banco: string | null };

function normalizar(r: Record<string, unknown>, fonte: string, agora: string): Normal | null {
  const codigoFonte = txt(r.codigo_fonte ?? r.codigo ?? r.id, 80);
  const uf = (txt(r.uf, 2) ?? "").toUpperCase();
  const cidade = txt(r.cidade, 120);
  const preco = num(r.preco ?? r.lance_minimo ?? r.valor);
  if (!codigoFonte || !UFS.has(uf) || !cidade || preco === null || preco <= 0) return null;

  const informada = String(r.origem ?? "").trim();
  const origem = ORIGENS.has(informada) ? informada : origemDe(r.origem, r.banco, r.vendedor, r.comitente);
  const codigoBanco = txt(r.codigo_banco ?? r.numero_banco, 80);
  const avaliacao = num(r.avaliacao ?? r.valor_avaliacao);
  const descontoInformado = num(r.desconto);
  const desconto = descontoInformado ??
    (avaliacao && avaliacao > preco ? Math.round((1 - preco / avaliacao) * 10000) / 100 : null);
  const fotosBrutas = Array.isArray(r.fotos) ? r.fotos : String(r.fotos ?? "").split(/[|\n]/);
  const fotos = fotosBrutas.map(url).filter((f): f is string => !!f).slice(0, 20);

  const id = origem === "caixa" && codigoBanco && /^\d{6,13}$/.test(codigoBanco)
    ? codigoBanco
    : `${origem}-${slug(codigoBanco ?? `${fonte}-${codigoFonte}`)}`;

  return {
    id,
    origem,
    fonte,
    codigo_fonte: codigoFonte,
    codigo_banco: codigoBanco,
    codigo_leilao: txt(r.codigo_leilao ?? r.lote, 80),
    uf,
    cidade,
    bairro: txt(r.bairro, 120),
    endereco: txt(r.endereco, 300),
    cep: txt(r.cep, 9),
    tipo: txt(r.tipo, 60),
    descricao: txt(r.descricao, 2000),
    preco,
    avaliacao,
    desconto,
    lance_leilao_2: num(r.lance_leilao_2),
    data_leilao_1: data(r.data_leilao_1),
    data_leilao_2: data(r.data_leilao_2),
    data_encerramento: data(r.data_encerramento),
    modalidade: txt(r.modalidade, 80),
    financiamento: bool(r.financiamento),
    leiloeiro: txt(r.leiloeiro, 160),
    leiloeiro_registro: txt(r.leiloeiro_registro, 80),
    intermediador: txt(r.intermediador, 160),
    matricula: txt(r.matricula, 60),
    cartorio: txt(r.cartorio, 160),
    processo: txt(r.processo, 40),
    vara: txt(r.vara, 160),
    edital_url: url(r.edital_url ?? r.edital),
    link: url(r.link),
    fotos: fotos.length ? fotos : null,
    area_total: num(r.area_total),
    area_privativa: num(r.area_privativa),
    area_terreno: num(r.area_terreno),
    quartos: int(r.quartos),
    vagas: int(r.vagas),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    ativo: true,
    visto_em: agora,
    atualizado: agora,
  };
}

// Campos que o parceiro pode completar num imóvel da Caixa que já veio da lista oficial.
const ENRIQUECE = [
  "codigo_leilao", "leiloeiro", "leiloeiro_registro", "intermediador", "matricula", "cartorio",
  "data_leilao_1", "data_leilao_2", "lance_leilao_2", "data_encerramento", "edital_url", "fotos",
  "latitude", "longitude", "cep",
];

async function autorizado(srv: any, req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (jwt && jwt.split(".").length === 3) {
    const { data: u } = await srv.auth.getUser(jwt);
    if (u?.user) {
      const { data: p } = await srv.from("perfis").select("perfil").eq("user_id", u.user.id).maybeSingle();
      if (p?.perfil === "admin") return true;
    }
  }
  const { data: tk } = await srv.from("config_privado").select("valor").eq("chave", "import_token").maybeSingle();
  return !!tk?.valor && req.headers.get("x-import-token") === tk.valor;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return resp({ erro: "use POST" }, 405);
  const srv = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  if (!(await autorizado(srv, req))) return resp({ erro: "não autorizado" }, 401);

  const corpo = await req.json().catch(() => ({}));
  const fonte = String(corpo.fonte ?? "");
  if (!FONTE.test(fonte) || fonte === "caixa_lista") return resp({ erro: "fonte inválida" }, 400);

  const { data: log } = await srv.from("importacoes").insert({ fonte }).select("id").single();
  const agora = new Date().toISOString();
  try {
    let brutos: Record<string, unknown>[] = [];
    if (Array.isArray(corpo.itens)) brutos = corpo.itens;
    else if (typeof corpo.csv === "string") brutos = lerCsv(corpo.csv);
    else {
      // Link de dados liberado pelo parceiro (nunca a página pública do site).
      const { data: cfg } = await srv.from("config_privado").select("valor").eq("chave", `feed_${fonte}_url`).maybeSingle();
      if (!cfg?.valor) throw new Error(`sem dados: envie itens/csv ou cadastre feed_${fonte}_url`);
      const r = await fetch(cfg.valor, { headers: { Accept: "application/json, text/csv" } });
      if (!r.ok) throw new Error(`parceiro respondeu ${r.status}`);
      const t = await r.text();
      brutos = t.trim().startsWith("[") || t.trim().startsWith("{")
        ? (() => { const j = JSON.parse(t); return Array.isArray(j) ? j : j.itens ?? j.items ?? []; })()
        : lerCsv(t);
    }

    const itens = brutos.map((r) => normalizar(r, fonte, agora)).filter((x): x is Normal => !!x);
    const descartados = brutos.length - itens.length;
    if (!itens.length) throw new Error("nenhum imóvel válido (confira uf, cidade, preço e código)");

    // Imóveis da Caixa que já existem pela lista oficial: só enriquecer.
    const idsCaixa = itens.filter((i) => i.origem === "caixa").map((i) => i.id);
    const existentesCaixa = new Set<string>();
    for (let k = 0; k < idsCaixa.length; k += 500) {
      const { data } = await srv.from("imoveis").select("id").eq("fonte", "caixa_lista").in("id", idsCaixa.slice(k, k + 500));
      for (const x of data ?? []) existentesCaixa.add(x.id);
    }
    let enriquecidos = 0;
    for (const i of itens.filter((x) => existentesCaixa.has(x.id))) {
      const extra = Object.fromEntries(ENRIQUECE.filter((c) => i[c] !== null && i[c] !== undefined).map((c) => [c, i[c]]));
      if (Object.keys(extra).length) {
        await srv.from("imoveis").update(extra).eq("id", i.id);
        enriquecidos++;
      }
    }

    const proprios = itens.filter((x) => !existentesCaixa.has(x.id));
    const antigos = new Map<string, { preco: number | null; ativo: boolean }>();
    for (let de = 0; ; de += 1000) {
      const { data } = await srv.from("imoveis").select("id,preco,ativo").eq("fonte", fonte).range(de, de + 999);
      for (const x of data ?? []) antigos.set(x.id, { preco: x.preco === null ? null : Number(x.preco), ativo: x.ativo });
      if (!data || data.length < 1000) break;
    }
    const hist = [];
    let novos = 0, alterados = 0;
    for (const i of proprios) {
      const a = antigos.get(i.id);
      if (!a) { novos++; hist.push({ imovel_id: i.id, preco: i.preco, desconto: i.desconto, modalidade: i.modalidade, evento: "entrou" }); }
      else if (a.preco !== i.preco || !a.ativo) { alterados++; hist.push({ imovel_id: i.id, preco: i.preco, desconto: i.desconto, modalidade: i.modalidade, evento: a.ativo ? "mudou" : "voltou" }); }
    }
    for (let k = 0; k < proprios.length; k += 500) {
      const { error } = await srv.from("imoveis").upsert(proprios.slice(k, k + 500), { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    for (let k = 0; k < hist.length; k += 1000) await srv.from("imoveis_historico").insert(hist.slice(k, k + 1000));

    let removidos = 0;
    if (corpo.completo === true) {
      const vistos = new Set(proprios.map((i) => i.id));
      const sairam = [...antigos.entries()].filter(([id, a]) => a.ativo && !vistos.has(id)).map(([id]) => id);
      for (let k = 0; k < sairam.length; k += 500) {
        const lote = sairam.slice(k, k + 500);
        await srv.from("imoveis").update({ ativo: false, atualizado: agora }).in("id", lote);
        await srv.from("imoveis_historico").insert(lote.map((id) => ({ imovel_id: id, evento: "saiu" })));
      }
      removidos = sairam.length;
    }

    await srv.from("importacoes").update({ fim: new Date().toISOString(), lidos: itens.length, novos, alterados, removidos }).eq("id", log!.id);
    return resp({ ok: true, fonte, lidos: brutos.length, validos: itens.length, descartados, novos, alterados, enriquecidos, removidos });
  } catch (e) {
    const msg = String((e as Error).message || e);
    await srv.from("importacoes").update({ fim: new Date().toISOString(), erro: msg }).eq("id", log!.id);
    return resp({ ok: false, erro: msg }, 400);
  }
});
