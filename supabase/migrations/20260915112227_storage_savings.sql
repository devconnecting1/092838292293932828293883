-- =============================================================================
-- Economia de armazenamento (guardar só o necessário)
-- =============================================================================
-- O app já comprime no navegador: foto de imóvel JPEG 1600 px + miniatura
-- {nome}__thumb.webp (400 px); banners JPEG; logo WebP (PNG só de fallback);
-- documento de cliente JPEG 2000 px ou PDF até 10 MB. Esta migração alinha o
-- banco a isso e cria as rotinas de retenção:
--  1. Buckets: property-media 2 MB (jpeg/webp), landing-assets 2 MB
--     (jpeg/png/webp), client-documents 10 MB (tipos mantidos) e CHECK de
--     client_documents.size_bytes até 10 MB. Aborta se algum objeto existente
--     violar os novos limites.
--  2. No máximo 20 fotos (property_media.kind = 'image') por imóvel: P0001
--     limite_fotos_imovel, detail {"limit": 20, "usage": n}.
--  3. Auditoria: reordenar cards do funil (só leads.position) não gera evento.
--  4. Retenção de audit_events: 180 dias; acessos a dado sensível
--     (log_access_event) ficam 5 anos. Job semanal retencao-auditoria.
--  5. cron.job_run_details: apaga execuções com mais de 14 dias. Job semanal
--     limpeza-historico-cron.
--  6. private.list_orphan_storage_objects: SÓ LEITURA. Lista arquivos de
--     property-media sem linha em property_media (remoção fica para o servidor,
--     via Storage API).
-- Nenhum dado de negócio ativo é apagado.

-- -----------------------------------------------------------------------------
-- 1. Buckets e tamanho de documentos
-- -----------------------------------------------------------------------------
-- Os limites do bucket valem só para novos uploads; mesmo assim, não reduzimos
-- limite com arquivo existente fora da regra (to_jsonb evita depender da coluna
-- metadata, que o stub do harness de testes não tem).
do $$
declare
  v_violations jsonb;
begin
  select jsonb_object_agg(v.bucket_id, v.n)
    into v_violations
  from (
    select o.bucket_id, count(*) as n
    from storage.objects o
    cross join lateral (
      select
        (to_jsonb(o) -> 'metadata' ->> 'size')::bigint as size_bytes,
        to_jsonb(o) -> 'metadata' ->> 'mimetype' as mime_type
    ) m
    where (
        o.bucket_id = 'property-media'
        and (m.size_bytes > 2 * 1024 * 1024 or m.mime_type not in ('image/jpeg', 'image/webp'))
      )
      or (o.bucket_id = 'landing-assets' and m.size_bytes > 2 * 1024 * 1024)
      or (o.bucket_id = 'client-documents' and m.size_bytes > 10 * 1024 * 1024)
    group by o.bucket_id
  ) v;

  if v_violations is not null then
    raise exception 'Há arquivos que violam os novos limites dos buckets: %', v_violations
      using errcode = 'P0001',
            hint = 'Recomprima ou remova esses arquivos pela Storage API antes de aplicar esta migração.';
  end if;
end;
$$;

-- property-media: foto principal JPEG e miniatura WebP (PNG não é mais aceito).
update storage.buckets
set file_size_limit = 2 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/webp']
where id = 'property-media';

-- landing-assets: banners JPEG, logo WebP com fallback PNG.
update storage.buckets
set file_size_limit = 2 * 1024 * 1024,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'landing-assets';

-- client-documents: PDF até 10 MB (imagens chegam como JPEG 2000 px); tipos mantidos.
update storage.buckets
set file_size_limit = 10 * 1024 * 1024
where id = 'client-documents';

-- Mesmo teto na linha do documento (10 MB = 10485760 bytes; nulo continua aceito).
alter table public.client_documents
  drop constraint client_documents_size_bytes_check,
  add constraint client_documents_size_bytes_check
    check (size_bytes >= 0 and size_bytes <= 10485760);

-- -----------------------------------------------------------------------------
-- 2. No máximo 20 fotos por imóvel
-- -----------------------------------------------------------------------------
-- Conta só kind = 'image' (igual a MAX_PROPERTY_PHOTOS no core e à Server
-- Action): vídeo e tour são URLs externas e não ocupam Storage. A miniatura
-- {nome}__thumb.webp é só um arquivo ao lado da foto, sem linha na tabela, então
-- não entra na conta. Vale para qualquer papel (inclusive gravação direta).
-- Advisory lock por imóvel: envios simultâneos não passam de 20.
create or replace function private.enforce_property_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 20;
  v_count integer;
begin
  if new.kind <> 'image' then
    return new;
  end if;

  -- UPDATE que não traz foto nova para o imóvel (ex.: legenda, posição).
  if tg_op = 'UPDATE' and old.kind = 'image' and old.property_id = new.property_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('property_media_photos:' || new.property_id::text, 0));

  select count(*)::integer into v_count
  from public.property_media m
  where m.organization_id = new.organization_id
    and m.property_id = new.property_id
    and m.kind = 'image'
    and m.id <> new.id;

  if v_count + 1 > c_limit then
    raise exception 'limite_fotos_imovel'
      using errcode = 'P0001',
            detail = jsonb_build_object('limit', c_limit, 'usage', v_count)::text;
  end if;

  return new;
end;
$$;

comment on function private.enforce_property_photo_limit() is
  'Trigger a1_property_photo_limit (property_media): no máximo 20 linhas kind = image por imóvel. Erro P0001 limite_fotos_imovel, detail {"limit": 20, "usage": n}. Miniaturas __thumb.webp não são linhas e não contam.';

revoke all on function private.enforce_property_photo_limit() from public, anon, authenticated;

-- "a1_": depois do modo leitura (a0_billing_writable) e antes das demais validações.
drop trigger if exists a1_property_photo_limit on public.property_media;
create trigger a1_property_photo_limit
  before insert or update of kind, property_id on public.property_media
  for each row execute function private.enforce_property_photo_limit();

-- -----------------------------------------------------------------------------
-- 3. Auditoria sem arrastos do funil
-- -----------------------------------------------------------------------------
-- Corpo igual ao de audit_triggers, com uma exceção para leads: UPDATE em que só
-- mudou position (ordem do card na coluna; updated_at já era ignorado) não gera
-- evento. Mudança de etapa (stage) e de qualquer outro campo continua auditada.
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_old jsonb;
  v_org uuid;
  v_changed text[];
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  v_org := (v_row ->> 'organization_id')::uuid;

  -- Exclusão em cascata da própria imobiliária: não há onde registrar.
  if not exists (select 1 from public.organizations o where o.id = v_org) then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select coalesce(array_agg(n.key order by n.key), '{}')
      into v_changed
    from jsonb_each(v_row) as n
    where n.key <> 'updated_at'
      and (v_old -> n.key) is distinct from n.value;

    if cardinality(v_changed) = 0 then
      return null;
    end if;

    -- Funil (kanban): só a ordem do card mudou.
    if tg_table_name = 'leads' and v_changed <@ array['position']::text[] then
      return null;
    end if;

    v_meta := jsonb_build_object('changed_fields', to_jsonb(v_changed));
  end if;

  case tg_table_name
    when 'memberships' then
      v_meta := v_meta || jsonb_build_object(
        'user_id', v_row ->> 'user_id',
        'role', v_row ->> 'role',
        'active', (v_row ->> 'active')::boolean
      );
      if tg_op = 'UPDATE' and (v_old ->> 'role') is distinct from (v_row ->> 'role') then
        v_meta := v_meta || jsonb_build_object('previous_role', v_old ->> 'role');
      end if;
    when 'properties' then
      v_meta := v_meta || jsonb_build_object('code', v_row ->> 'code', 'status', v_row ->> 'status');
    when 'client_documents' then
      v_meta := v_meta || jsonb_build_object('client_id', v_row ->> 'client_id');
    when 'clients' then
      v_meta := v_meta || jsonb_build_object('kind', v_row ->> 'kind');
    else
      null;
  end case;

  insert into public.audit_events (organization_id, actor_id, action, entity, entity_id, metadata)
  values (
    v_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_meta
  );

  return null;
end;
$$;

revoke all on function private.audit_row_change() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Retenção de audit_events
-- -----------------------------------------------------------------------------
-- Prazos:
--  * 180 dias: eventos de alteração (insert/update/delete dos triggers de
--    auditoria) e qualquer outra ação que não seja de acesso.
--  * 5 anos: acessos a dado sensível registrados por public.log_access_event
--    (ações view, download, export, print em clients, client_documents,
--    properties e leads; LGPD).
-- ATENÇÃO: 5 anos segue o prazo usual de guarda do setor imobiliário para
-- PLD/COAF, que AINDA DEPENDE DE VALIDAÇÃO JURÍDICA; se o jurídico pedir outro
-- prazo (ou guardar também as alterações), ajuste esta função em migração nova.
-- Apaga em lotes de 5.000 (até 100 lotes por execução); o que sobrar sai na
-- próxima semana. Sem índice novo: a varredura semanal é barata e um índice em
-- created_at custaria espaço em toda gravação de auditoria.
create or replace function private.cleanup_old_audit_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_access_actions constant text[] := array['view', 'download', 'export', 'print'];
  c_batch constant integer := 5000;
  c_max_batches constant integer := 100;
  v_deleted integer;
  v_total integer := 0;
  v_round integer := 0;
begin
  loop
    delete from public.audit_events a
    where a.id in (
      select e.id
      from public.audit_events e
      where (e.action <> all (c_access_actions) and e.created_at < now() - interval '180 days')
         or (e.action = any (c_access_actions) and e.created_at < now() - interval '5 years')
      limit c_batch
    );

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    v_round := v_round + 1;

    exit when v_deleted < c_batch or v_round >= c_max_batches;
  end loop;

  return v_total;
end;
$$;

comment on function private.cleanup_old_audit_events() is
  'Rotina agendada (pg_cron, job retencao-auditoria, domingo 04:23 UTC): apaga public.audit_events com mais de 180 dias, exceto acessos a dado sensível (log_access_event: view, download, export, print), que ficam 5 anos (prazo PLD/COAF pendente de validação jurídica). Lotes de 5.000, até 100 por execução. Retorna quantas linhas apagou.';

revoke all on function private.cleanup_old_audit_events() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Histórico do pg_cron
-- -----------------------------------------------------------------------------
-- cron.job_run_details cresce a cada execução (a cada 30 min só o job de
-- nonces). 14 dias bastam para investigar falhas.
create or replace function private.cleanup_old_cron_run_details()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from cron.job_run_details
  where coalesce(end_time, start_time) < now() - interval '14 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function private.cleanup_old_cron_run_details() is
  'Rotina agendada (pg_cron, job limpeza-historico-cron, domingo 04:47 UTC): apaga cron.job_run_details com mais de 14 dias (end_time, ou start_time se a execução não terminou). Retorna quantas linhas apagou.';

revoke all on function private.cleanup_old_cron_run_details() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Arquivos órfãos em property-media (SÓ LEITURA)
-- -----------------------------------------------------------------------------
-- NÃO apague em storage.objects por SQL: isso remove só o registro, o arquivo
-- físico continua cobrado (e o Storage bloqueia com storage.protect_delete).
-- A remoção deve ser feita por uma rotina futura no servidor, via Storage API
-- (remove), usando esta lista. Regras:
--  * órfão = objeto de property-media sem linha em property_media com o mesmo
--    storage_path;
--  * {nome}__thumb.webp pertence à foto {nome}.{ext}: só é órfã se a foto
--    principal também não tiver linha;
--  * objetos com menos de 24 h ficam de fora (o navegador envia o arquivo antes
--    de a Server Action gravar a linha).
-- Sem EXECUTE para anon/authenticated: rode pelo SQL Editor/MCP (postgres).
create or replace function private.list_orphan_storage_objects(p_limit integer default 100)
returns table (name text, size_bytes bigint, created_at timestamptz, is_thumbnail boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit deve estar entre 1 e 1000.' using errcode = '22023';
  end if;

  return query
  select
    o.name,
    (o.metadata ->> 'size')::bigint,
    o.created_at,
    x.is_thumb
  from storage.objects o
  cross join lateral (
    select
      storage.foldername(o.name) as folders,
      right(o.name, 12) = '__thumb.webp' as is_thumb
  ) x
  where o.bucket_id = 'property-media'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select 1
      from public.property_media m
      where m.organization_id = private.try_uuid(x.folders[1])
        and m.property_id = private.try_uuid(x.folders[3])
        and (
          m.storage_path = o.name
          or (
            x.is_thumb
            and regexp_replace(m.storage_path, '\.[^./]*$', '') || '__thumb.webp' = o.name
          )
        )
    )
  order by o.created_at, o.name
  limit p_limit;
end;
$$;

comment on function private.list_orphan_storage_objects(integer) is
  'SÓ LEITURA: lista até p_limit (1 a 1000) objetos do bucket property-media, com mais de 24 h, sem linha correspondente em public.property_media ({nome}__thumb.webp pertence à foto {nome}.{ext}). A remoção deve ser feita pelo servidor via Storage API, nunca por DELETE em storage.objects.';

revoke all on function private.list_orphan_storage_objects(integer) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Agendamento (idempotente: reagenda do zero se o job já existir)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'retencao-auditoria') then
    perform cron.unschedule('retencao-auditoria');
  end if;
end;
$$;

select cron.schedule(
  'retencao-auditoria',
  '23 4 * * 0',
  $cron$ select private.cleanup_old_audit_events(); $cron$
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'limpeza-historico-cron') then
    perform cron.unschedule('limpeza-historico-cron');
  end if;
end;
$$;

select cron.schedule(
  'limpeza-historico-cron',
  '47 4 * * 0',
  $cron$ select private.cleanup_old_cron_run_details(); $cron$
);
