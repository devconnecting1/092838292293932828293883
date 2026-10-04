-- =============================================================================
-- 2600 - Imóveis da Caixa: catálogo compartilhado, favoritos e vínculos
-- =============================================================================
--  1. Segredo do Vault (caixa_server_key) e status da carga
--  2. public.caixa_listings — catálogo SEM organization_id (o mesmo dado para
--     todos os assinantes, gravado uma vez), RLS com uma única política de
--     leitura para authenticated e nenhuma de escrita
--  3. Busca (trigrama sobre número, endereço, bairro, cidade e UF)
--  4. RPCs de escrita, só com a chave do servidor: ingest_caixa_listings e
--     finish_caixa_sync. Nunca service_role
--  5. RPCs de leitura: search_caixa_listings e caixa_catalog_facets
--  6. Por imobiliária: caixa_favorites e caixa_client_links, com RLS normal
--
-- O que NÃO entra aqui, de propósito:
--   - a FOTO. Nem o arquivo, nem miniatura, nem uma coluna com a URL. A URL é
--     calculada na renderização a partir do número (packages/core/src/caixa).
--     Coluna guardada é coluna que alguém um dia preenche com um caminho do
--     nosso bucket — e aí o catálogo passaria a consumir armazenamento.
--   - matrícula, situação de ocupação e aceitação de FGTS: não estão no arquivo
--     nacional e só sairiam com uma requisição por imóvel (8.094/dia) ao site da
--     Caixa. Quem confere isso é o corretor, na página oficial (coluna `link`).
--   - desconto calculado. Em 2.164 dos 8.094 imóveis (26,7%) o preço é MAIOR
--     que a avaliação; subtrair os dois valores inventaria número. Só a coluna
--     `desconto`, como a Caixa publica, e só quando ela existir.

-- -----------------------------------------------------------------------------
-- 1. Segredo do Vault e status da carga
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets s where s.name = 'caixa_server_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'caixa_server_key',
      'Chave do servidor Next para gravar o catálogo da Caixa (env CAIXA_SERVER_KEY).'
    );
  end if;
end;
$$;

-- Uma linha só: o que a tela mostra como "última atualização bem-sucedida".
create table public.caixa_catalog_status (
  singleton boolean primary key default true constraint caixa_catalog_status_singleton check (singleton),
  -- Data que a PRÓPRIA Caixa declara na linha 2 do arquivo, não a hora do cron.
  lista_gerada_em date,
  -- Quando a última carga terminou sem erro.
  sincronizado_em timestamptz,
  total_ativo integer not null default 0 check (total_ativo >= 0),
  ultima_carga_total integer not null default 0 check (ultima_carga_total >= 0),
  ultima_carga_recusada integer not null default 0 check (ultima_carga_recusada >= 0),
  ultima_carga_saiu integer not null default 0 check (ultima_carga_saiu >= 0),
  atualizado_em timestamptz not null default now()
);

insert into public.caixa_catalog_status (singleton) values (true);

comment on table public.caixa_catalog_status is
  'Estado da última carga do catálogo da Caixa. lista_gerada_em é a data declarada pela Caixa no arquivo; sincronizado_em é quando a nossa carga terminou. A tela mostra as duas para o corretor saber a idade do dado.';

alter table public.caixa_catalog_status enable row level security;

create policy "caixa_catalog_status: membros leem"
  on public.caixa_catalog_status for select to authenticated
  using (true);

revoke all on public.caixa_catalog_status from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.caixa_catalog_status from authenticated;
grant select on public.caixa_catalog_status to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Catálogo compartilhado
-- -----------------------------------------------------------------------------
-- Sem organization_id de propósito: são os mesmos ~8.100 imóveis para todo
-- assinante. Copiar por imobiliária seria 100 clientes × 8.100 linhas do mesmo
-- conteúdo. Sem created_by: o dado é externo, não tem autor nosso.
create table public.caixa_listings (
  numero text primary key constraint caixa_listings_numero_format check (numero ~ '^[0-9]{1,13}$'),
  uf text not null constraint caixa_listings_uf_format check (uf ~ '^[A-Z]{2}$'),
  cidade text not null constraint caixa_listings_cidade_len check (char_length(cidade) between 1 and 120),
  bairro text constraint caixa_listings_bairro_len check (char_length(bairro) <= 120),
  endereco text not null constraint caixa_listings_endereco_len check (char_length(endereco) between 1 and 300),
  -- Valor mínimo de venda vigente publicado pela Caixa (coluna "Preço").
  preco numeric(14, 2) not null constraint caixa_listings_preco_range check (preco >= 0),
  valor_avaliacao numeric(14, 2) constraint caixa_listings_avaliacao_range check (valor_avaliacao >= 0),
  -- Percentual PUBLICADO na coluna 8. Nunca calculado a partir dos dois valores.
  desconto numeric(5, 2) constraint caixa_listings_desconto_range check (desconto >= 0 and desconto <= 100),
  -- null = o arquivo não disse; a tela não afirma nada nesse caso.
  aceita_financiamento boolean,
  descricao text constraint caixa_listings_descricao_len check (char_length(descricao) <= 1000),
  modalidade text constraint caixa_listings_modalidade_len check (char_length(modalidade) <= 80),
  -- Vira href na tela: só o site da Caixa.
  link text not null constraint caixa_listings_link_host
    check (link like 'https://venda-imoveis.caixa.gov.br/%' and link !~ '[[:space:][:cntrl:]]' and char_length(link) <= 300),
  -- Derivado da Descrição (texto livre com gramática regular), só para filtrar.
  tipo public.property_type not null default 'other',
  area_total numeric(14, 2) constraint caixa_listings_area_total_range check (area_total > 0),
  area_privativa numeric(14, 2) constraint caixa_listings_area_privativa_range check (area_privativa > 0),
  area_terreno numeric(14, 2) constraint caixa_listings_area_terreno_range check (area_terreno > 0),
  quartos smallint constraint caixa_listings_quartos_range check (quartos between 1 and 999),
  vagas smallint constraint caixa_listings_vagas_range check (vagas between 1 and 999),
  -- Data de geração declarada pela Caixa na linha em que este imóvel foi visto.
  lista_gerada_em date,
  -- Carga que viu este imóvel pela última vez (marca quem sumiu do arquivo).
  sincronizacao_id uuid not null,
  primeira_vez_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Nunca apagamos linha: o imóvel que sumiu do arquivo fica marcado, para o
  -- favorito e o vínculo do corretor não desaparecerem sem explicação.
  saiu_da_lista_em timestamptz
);

comment on table public.caixa_listings is
  'Cópia dos campos factuais da lista pública de imóveis da Caixa (Lista_imoveis_geral.csv), compartilhada por todos os assinantes. Leitura para authenticated; escrita só pelas RPCs com a chave caixa_server_key do Vault. Sem foto e sem URL de foto: a URL é derivada do número na renderização.';

comment on column public.caixa_listings.desconto is
  'Percentual como a Caixa publica (coluna 8 do CSV). NÃO calcule desconto a partir de preco e valor_avaliacao: em 26,7% dos imóveis o preço é maior que a avaliação.';

comment on column public.caixa_listings.saiu_da_lista_em is
  'Quando o imóvel deixou de aparecer no arquivo. Linha nunca é apagada; a tela mostra "saiu da lista da Caixa em ...".';

create index caixa_listings_uf_cidade_idx
  on public.caixa_listings (uf, cidade)
  where saiu_da_lista_em is null;

create index caixa_listings_preco_idx
  on public.caixa_listings (preco)
  where saiu_da_lista_em is null;

create index caixa_listings_novidades_idx
  on public.caixa_listings (primeira_vez_em desc, numero)
  where saiu_da_lista_em is null;

create index caixa_listings_sincronizacao_idx
  on public.caixa_listings (sincronizacao_id);

alter table public.caixa_listings enable row level security;

-- Uma única política, e de leitura. É catálogo: todo membro autenticado vê o
-- mesmo. Sem política de insert/update/delete — quem escreve é só a RPC.
create policy "caixa_listings: catálogo público para membros"
  on public.caixa_listings for select to authenticated
  using (true);

revoke all on public.caixa_listings from anon;
revoke insert, update, delete, truncate, trigger, references
  on public.caixa_listings from authenticated;
grant select on public.caixa_listings to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Busca por trecho (mesmo desenho da lista de imóveis do CRM)
-- -----------------------------------------------------------------------------
create or replace function private.caixa_search_text(
  p_numero text,
  p_endereco text,
  p_bairro text,
  p_cidade text,
  p_uf text
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select private.search_normalize(
    concat_ws(' ', p_numero, p_endereco, p_bairro, p_cidade, p_uf)
  );
$$;

comment on function private.caixa_search_text(text, text, text, text, text) is
  'Texto normalizado do imóvel da Caixa para a busca por trecho (número, endereço, bairro, cidade e UF). Usada no índice caixa_listings_search_idx e em public.search_caixa_listings.';

revoke all on function private.caixa_search_text(text, text, text, text, text) from public, anon;
grant execute on function private.caixa_search_text(text, text, text, text, text) to authenticated;

create index caixa_listings_search_idx
  on public.caixa_listings
  using gin (
    private.caixa_search_text(numero, endereco, bairro, cidade, uf)
    extensions.gin_trgm_ops
  );

-- -----------------------------------------------------------------------------
-- 4. Escrita: só com a chave do servidor (Vault), nunca service_role
-- -----------------------------------------------------------------------------
create or replace function private.caixa_server_key_ok(p_server_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from vault.decrypted_secrets ds
    where ds.name = 'caixa_server_key'
      and p_server_key is not null
      and extensions.digest(p_server_key, 'sha256') = extensions.digest(ds.decrypted_secret, 'sha256')
  );
$$;

revoke all on function private.caixa_server_key_ok(text) from public, anon, authenticated;

-- Grava um lote do arquivo. Idempotente por `numero`: reexecutar o mesmo lote
-- não duplica nada. Linha malformada é descartada e contada, sem derrubar o
-- lote — o arquivo é dado não confiável e a carga não pode virar tudo-ou-nada
-- por causa de um registro torto.
create or replace function public.ingest_caixa_listings(
  p_server_key text,
  p_sync_id uuid,
  p_generated_on date,
  p_rows jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_sync_id is null then
    raise exception 'Informe a carga (p_sync_id).' using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Informe os imóveis em um array.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Envie no máximo 2.000 imóveis por chamada.' using errcode = '22023';
  end if;

  with input as (
    select *
    from jsonb_to_recordset(p_rows) as r(
      numero text,
      uf text,
      cidade text,
      bairro text,
      endereco text,
      preco numeric,
      valor_avaliacao numeric,
      desconto numeric,
      aceita_financiamento boolean,
      descricao text,
      modalidade text,
      link text,
      tipo text,
      area_total numeric,
      area_privativa numeric,
      area_terreno numeric,
      quartos numeric,
      vagas numeric
    )
  ),
  valid as (
    select distinct on (i.numero)
      i.numero,
      upper(btrim(i.uf)) as uf,
      left(btrim(i.cidade), 120) as cidade,
      nullif(left(btrim(coalesce(i.bairro, '')), 120), '') as bairro,
      left(btrim(i.endereco), 300) as endereco,
      round(i.preco, 2) as preco,
      case when i.valor_avaliacao >= 0 then round(i.valor_avaliacao, 2) end as valor_avaliacao,
      case when i.desconto between 0 and 100 then round(i.desconto, 2) end as desconto,
      i.aceita_financiamento,
      nullif(left(btrim(coalesce(i.descricao, '')), 1000), '') as descricao,
      nullif(left(btrim(coalesce(i.modalidade, '')), 80), '') as modalidade,
      i.link,
      case
        when i.tipo = any (enum_range(null::public.property_type)::text[])
          then i.tipo::public.property_type
        else 'other'::public.property_type
      end as tipo,
      case when i.area_total > 0 then round(i.area_total, 2) end as area_total,
      case when i.area_privativa > 0 then round(i.area_privativa, 2) end as area_privativa,
      case when i.area_terreno > 0 then round(i.area_terreno, 2) end as area_terreno,
      case when i.quartos between 1 and 999 then i.quartos::smallint end as quartos,
      case when i.vagas between 1 and 999 then i.vagas::smallint end as vagas
    from input i
    where i.numero ~ '^[0-9]{1,13}$'
      and upper(btrim(coalesce(i.uf, ''))) ~ '^[A-Z]{2}$'
      and btrim(coalesce(i.cidade, '')) <> ''
      and btrim(coalesce(i.endereco, '')) <> ''
      and i.preco >= 0
      and i.preco <= 999999999999.99
      and coalesce(i.valor_avaliacao, 0) <= 999999999999.99
      and coalesce(i.area_total, 0) <= 999999999999.99
      and coalesce(i.area_privativa, 0) <= 999999999999.99
      and coalesce(i.area_terreno, 0) <= 999999999999.99
      and i.link like 'https://venda-imoveis.caixa.gov.br/%'
      and i.link !~ '[[:space:][:cntrl:]]'
      and char_length(i.link) <= 300
    -- distinct on exige a mesma coluna à frente do order by (e garante que o
    -- lote não toque a mesma chave duas vezes no on conflict).
    order by i.numero
  ),
  upserted as (
    insert into public.caixa_listings as l (
      numero, uf, cidade, bairro, endereco, preco, valor_avaliacao, desconto,
      aceita_financiamento, descricao, modalidade, link, tipo,
      area_total, area_privativa, area_terreno, quartos, vagas,
      lista_gerada_em, sincronizacao_id
    )
    select
      v.numero, v.uf, v.cidade, v.bairro, v.endereco, v.preco, v.valor_avaliacao, v.desconto,
      v.aceita_financiamento, v.descricao, v.modalidade, v.link, v.tipo,
      v.area_total, v.area_privativa, v.area_terreno, v.quartos, v.vagas,
      p_generated_on, p_sync_id
    from valid v
    on conflict (numero) do update set
      uf = excluded.uf,
      cidade = excluded.cidade,
      bairro = excluded.bairro,
      endereco = excluded.endereco,
      preco = excluded.preco,
      valor_avaliacao = excluded.valor_avaliacao,
      desconto = excluded.desconto,
      aceita_financiamento = excluded.aceita_financiamento,
      descricao = excluded.descricao,
      modalidade = excluded.modalidade,
      link = excluded.link,
      tipo = excluded.tipo,
      area_total = excluded.area_total,
      area_privativa = excluded.area_privativa,
      area_terreno = excluded.area_terreno,
      quartos = excluded.quartos,
      vagas = excluded.vagas,
      lista_gerada_em = excluded.lista_gerada_em,
      sincronizacao_id = excluded.sincronizacao_id,
      atualizado_em = now(),
      -- Imóvel que tinha sumido e voltou ao arquivo volta a ficar ativo.
      saiu_da_lista_em = null
    -- xmax = 0 só na linha recém-inserida; nas atualizadas vem o xid da transação.
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'received', (select count(*) from input),
    'accepted', (select count(*) from valid),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'rejected', (select count(*) from input) - (select count(*) from valid)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.ingest_caixa_listings(text, uuid, date, jsonb) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): grava um lote do Lista_imoveis_geral.csv em public.caixa_listings. Upsert por numero, linha inválida descartada e contada. Devolve {received, accepted, inserted, updated, rejected}.';

revoke all on function public.ingest_caixa_listings(text, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_caixa_listings(text, uuid, date, jsonb) to anon, authenticated;

-- Fecha a carga: marca como fora da lista quem não apareceu nesta sincronização
-- e registra o estado para a tela. NUNCA apaga linha.
create or replace function public.finish_caixa_sync(
  p_server_key text,
  p_sync_id uuid,
  p_generated_on date,
  p_rejected integer default 0
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Piso de segurança: o arquivo nacional tem ~8.100 imóveis. Carga menor que
  -- isso é sinal de arquivo truncado, e marcar milhares de imóveis como "saiu
  -- da lista" por causa de um download pela metade seria pior que não atualizar.
  v_min_listings constant integer := 1000;
  v_seen integer;
  v_delisted integer;
  v_total integer;
begin
  if not private.caixa_server_key_ok(p_server_key) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  if p_sync_id is null then
    raise exception 'Informe a carga (p_sync_id).' using errcode = '22023';
  end if;

  select count(*) into v_seen
  from public.caixa_listings l
  where l.sincronizacao_id = p_sync_id;

  if v_seen < v_min_listings then
    raise exception 'Carga incompleta (% imóveis): o catálogo anterior foi preservado.', v_seen
      using errcode = '22023';
  end if;

  update public.caixa_listings l
  set saiu_da_lista_em = now()
  where l.sincronizacao_id <> p_sync_id
    and l.saiu_da_lista_em is null;

  get diagnostics v_delisted = row_count;

  select count(*) into v_total
  from public.caixa_listings l
  where l.saiu_da_lista_em is null;

  update public.caixa_catalog_status s
  set lista_gerada_em = coalesce(p_generated_on, s.lista_gerada_em),
      sincronizado_em = now(),
      total_ativo = v_total,
      ultima_carga_total = v_seen,
      ultima_carga_recusada = greatest(coalesce(p_rejected, 0), 0),
      ultima_carga_saiu = v_delisted,
      atualizado_em = now()
  where s.singleton;

  return jsonb_build_object(
    'seen', v_seen,
    'delisted', v_delisted,
    'total', v_total
  );
end;
$$;

comment on function public.finish_caixa_sync(text, uuid, date, integer) is
  'Servidor Next (chave publishable + CAIXA_SERVER_KEY): fecha a carga do catálogo da Caixa. Marca saiu_da_lista_em em quem não apareceu na sincronização e grava public.caixa_catalog_status. Recusa (22023) carga com menos de 1.000 imóveis, para um download truncado não zerar o catálogo. Nunca apaga linha.';

revoke all on function public.finish_caixa_sync(text, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.finish_caixa_sync(text, uuid, date, integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Por imobiliária: favoritos e vínculos com a carteira
-- -----------------------------------------------------------------------------
create table public.caixa_favorites (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- restrict de propósito: um expurgo futuro do catálogo tem que falhar alto se
  -- esquecer de poupar o que alguém favoritou, em vez de apagar em silêncio.
  numero text not null references public.caixa_listings (numero) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, numero)
);

comment on table public.caixa_favorites is
  'Imóveis da Caixa favoritados por cada usuário, por imobiliária. É o que transforma 8.000 imóveis em "os meus 12".';

create index caixa_favorites_numero_idx on public.caixa_favorites (numero);
create index caixa_favorites_user_idx on public.caixa_favorites (user_id);

alter table public.caixa_favorites enable row level security;

create policy "caixa_favorites: cada um vê os seus"
  on public.caixa_favorites for select to authenticated
  using (private.is_member(organization_id) and user_id = (select auth.uid()));

create policy "caixa_favorites: cada um favorita para si"
  on public.caixa_favorites for insert to authenticated
  with check (private.is_member(organization_id) and user_id = (select auth.uid()));

create policy "caixa_favorites: cada um desfavorita os seus"
  on public.caixa_favorites for delete to authenticated
  using (private.is_member(organization_id) and user_id = (select auth.uid()));

revoke all on public.caixa_favorites from anon;
revoke insert, update, truncate, trigger, references on public.caixa_favorites from authenticated;
grant select, delete on public.caixa_favorites to authenticated;
grant insert (organization_id, user_id, numero) on public.caixa_favorites to authenticated;

-- Quem pode ligar um imóvel da Caixa a este cliente/lead: a mesma régua que o
-- projeto já usa em property_owners (cliente acessível) e no funil (lead
-- acessível). Exatamente um dos dois é informado.
create or replace function private.can_access_caixa_link(
  org uuid,
  p_client uuid,
  p_lead uuid,
  for_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not private.is_member(org) then false
    when (p_client is null) = (p_lead is null) then false
    when p_client is not null then
      coalesce((
        select private.can_access_client_row(c.organization_id, c.id, c.assigned_to, c.created_by, for_write)
        from public.clients c
        where c.organization_id = org
          and c.id = p_client
      ), false)
    else
      coalesce((
        select private.can_access_lead_row(l.organization_id, l.assigned_to, for_write)
        from public.leads l
        where l.organization_id = org
          and l.id = p_lead
      ), false)
  end;
$$;

comment on function private.can_access_caixa_link(uuid, uuid, uuid, boolean) is
  'Vínculo entre imóvel da Caixa e carteira: exige membro ativo e acesso ao cliente (can_access_client_row) ou ao lead (can_access_lead_row). Exatamente um dos dois.';

revoke all on function private.can_access_caixa_link(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_caixa_link(uuid, uuid, uuid, boolean) to authenticated;

create table public.caixa_client_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  numero text not null references public.caixa_listings (numero) on delete restrict,
  client_id uuid,
  lead_id uuid,
  notes text constraint caixa_client_links_notes_len check (char_length(notes) <= 1000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint caixa_client_links_target check (num_nonnulls(client_id, lead_id) = 1),
  constraint caixa_client_links_client_fkey foreign key (organization_id, client_id)
    references public.clients (organization_id, id) on delete cascade,
  constraint caixa_client_links_lead_fkey foreign key (organization_id, lead_id)
    references public.leads (organization_id, id) on delete cascade
);

comment on table public.caixa_client_links is
  'Imóvel da Caixa ligado a um cliente ou a um lead da carteira da imobiliária. É o que amarra o catálogo ao CRM em vez de deixá-lo como um site de consulta paralelo.';

create unique index caixa_client_links_client_idx
  on public.caixa_client_links (organization_id, numero, client_id)
  where client_id is not null;

create unique index caixa_client_links_lead_idx
  on public.caixa_client_links (organization_id, numero, lead_id)
  where lead_id is not null;

create index caixa_client_links_organization_numero_idx
  on public.caixa_client_links (organization_id, numero);
create index caixa_client_links_numero_idx on public.caixa_client_links (numero);
create index caixa_client_links_created_by_idx on public.caixa_client_links (created_by);
create index caixa_client_links_organization_client_idx
  on public.caixa_client_links (organization_id, client_id);
create index caixa_client_links_organization_lead_idx
  on public.caixa_client_links (organization_id, lead_id);

create trigger caixa_client_links_set_updated_at
  before update on public.caixa_client_links
  for each row execute function private.set_updated_at();

create trigger caixa_client_links_lock_organization
  before update on public.caixa_client_links
  for each row execute function private.lock_organization_id();

create trigger caixa_client_links_enforce_author
  before insert or update of created_by on public.caixa_client_links
  for each row execute function private.enforce_author_column('created_by');

alter table public.caixa_client_links enable row level security;

create policy "caixa_client_links: quem vê o cliente ou o lead vê o vínculo"
  on public.caixa_client_links for select to authenticated
  using (private.can_access_caixa_link(organization_id, client_id, lead_id, false));

create policy "caixa_client_links: quem edita o cliente ou o lead cria o vínculo"
  on public.caixa_client_links for insert to authenticated
  with check (private.can_access_caixa_link(organization_id, client_id, lead_id, true));

create policy "caixa_client_links: quem edita o cliente ou o lead altera a nota"
  on public.caixa_client_links for update to authenticated
  using (private.can_access_caixa_link(organization_id, client_id, lead_id, true))
  with check (private.can_access_caixa_link(organization_id, client_id, lead_id, true));

create policy "caixa_client_links: quem edita o cliente ou o lead remove o vínculo"
  on public.caixa_client_links for delete to authenticated
  using (private.can_access_caixa_link(organization_id, client_id, lead_id, true));

revoke all on public.caixa_client_links from anon;
revoke insert, update, truncate, trigger, references on public.caixa_client_links from authenticated;
grant select, delete on public.caixa_client_links to authenticated;
grant insert (organization_id, numero, client_id, lead_id, notes)
  on public.caixa_client_links to authenticated;
grant update (notes) on public.caixa_client_links to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Leitura: lista com filtros e facetas dos filtros
-- -----------------------------------------------------------------------------
-- `security invoker` (o padrão): quem manda no resultado é o RLS. O catálogo é
-- o mesmo para todos; o favorito e o vínculo só aparecem para quem pode vê-los.
create or replace function public.search_caixa_listings(
  p_organization_id uuid,
  p_term text default null,
  p_uf text default null,
  p_cidade text default null,
  p_bairro text default null,
  p_tipo public.property_type default null,
  p_modalidade text default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_financiamento boolean default null,
  p_only_favorites boolean default false,
  p_include_delisted boolean default false,
  p_sort text default 'novidades',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  numero text,
  uf text,
  cidade text,
  bairro text,
  endereco text,
  preco numeric,
  valor_avaliacao numeric,
  desconto numeric,
  aceita_financiamento boolean,
  descricao text,
  modalidade text,
  link text,
  tipo public.property_type,
  area_total numeric,
  area_privativa numeric,
  area_terreno numeric,
  quartos smallint,
  vagas smallint,
  lista_gerada_em date,
  primeira_vez_em timestamptz,
  saiu_da_lista_em timestamptz,
  is_favorite boolean,
  link_count bigint,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with args as (
    select
      case
        when nullif(btrim(coalesce(p_term, '')), '') is null then null
        else '%' || replace(
               replace(
                 replace(private.search_normalize(btrim(p_term)), '\', '\\'),
                 '%', '\%'
               ),
               '_', '\_'
             ) || '%'
      end as like_pattern,
      case
        when nullif(btrim(coalesce(p_bairro, '')), '') is null then null
        else '%' || replace(
               replace(
                 replace(private.search_normalize(btrim(p_bairro)), '\', '\\'),
                 '%', '\%'
               ),
               '_', '\_'
             ) || '%'
      end as bairro_pattern,
      case
        when coalesce(p_sort, 'novidades') in ('novidades', 'preco_asc', 'preco_desc', 'desconto')
          then coalesce(p_sort, 'novidades')
        else 'novidades'
      end as sort
  ),
  page as (
    select
      l.*,
      count(*) over () as total_count,
      row_number() over (
        order by
          case when a.sort = 'preco_asc' then l.preco end asc nulls last,
          case when a.sort = 'preco_desc' then l.preco end desc nulls last,
          case when a.sort = 'desconto' then l.desconto end desc nulls last,
          case when a.sort = 'novidades' then l.primeira_vez_em end desc nulls last,
          l.numero
      ) as ordem
    from public.caixa_listings l
    cross join args a
    where (p_include_delisted or l.saiu_da_lista_em is null)
      and (p_uf is null or l.uf = upper(btrim(p_uf)))
      and (p_cidade is null or private.search_normalize(l.cidade) = private.search_normalize(btrim(p_cidade)))
      and (a.bairro_pattern is null or private.search_normalize(coalesce(l.bairro, '')) like a.bairro_pattern escape '\')
      and (p_tipo is null or l.tipo = p_tipo)
      and (p_modalidade is null or l.modalidade = p_modalidade)
      and (p_min_price is null or l.preco >= p_min_price)
      and (p_max_price is null or l.preco <= p_max_price)
      and (p_financiamento is null or l.aceita_financiamento is not distinct from p_financiamento)
      and (
        a.like_pattern is null
        or private.caixa_search_text(l.numero, l.endereco, l.bairro, l.cidade, l.uf)
             like a.like_pattern escape '\'
      )
      and (
        not coalesce(p_only_favorites, false)
        or exists (
          select 1
          from public.caixa_favorites f
          where f.organization_id = p_organization_id
            and f.user_id = (select auth.uid())
            and f.numero = l.numero
        )
      )
    order by
      case when a.sort = 'preco_asc' then l.preco end asc nulls last,
      case when a.sort = 'preco_desc' then l.preco end desc nulls last,
      case when a.sort = 'desconto' then l.desconto end desc nulls last,
      case when a.sort = 'novidades' then l.primeira_vez_em end desc nulls last,
      l.numero
    limit least(greatest(coalesce(p_limit, 24), 1), 60)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    page.numero,
    page.uf,
    page.cidade,
    page.bairro,
    page.endereco,
    page.preco,
    page.valor_avaliacao,
    page.desconto,
    page.aceita_financiamento,
    page.descricao,
    page.modalidade,
    page.link,
    page.tipo,
    page.area_total,
    page.area_privativa,
    page.area_terreno,
    page.quartos,
    page.vagas,
    page.lista_gerada_em,
    page.primeira_vez_em,
    page.saiu_da_lista_em,
    exists (
      select 1
      from public.caixa_favorites f
      where f.organization_id = p_organization_id
        and f.user_id = (select auth.uid())
        and f.numero = page.numero
    ) as is_favorite,
    (
      select count(*)
      from public.caixa_client_links k
      where k.organization_id = p_organization_id
        and k.numero = page.numero
    ) as link_count,
    page.total_count
  from page
  order by page.ordem;
$$;

comment on function public.search_caixa_listings(
  uuid, text, text, text, text, public.property_type, text, numeric, numeric,
  boolean, boolean, boolean, text, integer, integer
) is
  'Catálogo da Caixa com filtros, busca por trecho (número, endereço, bairro, cidade, UF), paginação (p_limit 1-60) e total_count repetido em todas as linhas. Devolve is_favorite e link_count da imobiliária informada. Security invoker: o catálogo é igual para todos, mas favorito e vínculo respeitam o RLS.';

revoke all on function public.search_caixa_listings(
  uuid, text, text, text, text, public.property_type, text, numeric, numeric,
  boolean, boolean, boolean, text, integer, integer
) from public, anon;
grant execute on function public.search_caixa_listings(
  uuid, text, text, text, text, public.property_type, text, numeric, numeric,
  boolean, boolean, boolean, text, integer, integer
) to authenticated;

-- Opções dos filtros, contadas no banco: UFs com imóveis, cidades da UF
-- escolhida e modalidades de venda em uso.
create or replace function public.caixa_catalog_facets(p_uf text default null)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ufs', coalesce((
      select jsonb_agg(jsonb_build_object('uf', t.uf, 'count', t.total) order by t.uf)
      from (
        select l.uf, count(*) as total
        from public.caixa_listings l
        where l.saiu_da_lista_em is null
        group by l.uf
      ) t
    ), '[]'::jsonb),
    'cidades', coalesce((
      select jsonb_agg(jsonb_build_object('cidade', t.cidade, 'count', t.total) order by t.cidade)
      from (
        select l.cidade, count(*) as total
        from public.caixa_listings l
        where l.saiu_da_lista_em is null
          and p_uf is not null
          and l.uf = upper(btrim(p_uf))
        group by l.cidade
      ) t
    ), '[]'::jsonb),
    'modalidades', coalesce((
      select jsonb_agg(jsonb_build_object('modalidade', t.modalidade, 'count', t.total) order by t.modalidade)
      from (
        select l.modalidade, count(*) as total
        from public.caixa_listings l
        where l.saiu_da_lista_em is null
          and l.modalidade is not null
        group by l.modalidade
      ) t
    ), '[]'::jsonb)
  );
$$;

comment on function public.caixa_catalog_facets(text) is
  'Opções dos filtros do catálogo da Caixa: UFs com imóveis ativos, cidades da UF informada e modalidades de venda em uso, com a contagem de cada uma.';

revoke all on function public.caixa_catalog_facets(text) from public, anon;
grant execute on function public.caixa_catalog_facets(text) to authenticated;
