-- =============================================================================
-- Rotinas agendadas de manutenção (pg_cron, grátis no plano Free)
-- =============================================================================
-- Habilita a extensão pg_cron do jeito recomendado pela Supabase
-- (https://supabase.com/docs/guides/cron/install). No PGlite (harness de
-- testes) a extensão não existe entre as disponíveis, então o bloco é
-- pulado sem erro; localmente o schema `cron` é substituído por um stub
-- (ver stubs.sql do harness de testes).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron with schema pg_catalog';
    execute 'grant usage on schema cron to postgres';
    execute 'grant all privileges on all tables in schema cron to postgres';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Funções de limpeza (schema private, security definer, sem grant para
--    anon/authenticated: só as rotinas agendadas as executam).
-- -----------------------------------------------------------------------------

-- Nonces de submit_capture_request/submit_landing_lead (validade real: 12h).
-- As duas RPCs já limpam nonces vencidos a cada envio aceito; esta função é
-- só um backstop para quando não há tráfego (apaga com folga, 24h).
create or replace function private.cleanup_expired_nonces()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.capture_request_nonces
  where created_at < now() - interval '24 hours';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function private.cleanup_expired_nonces() is
  'Rotina agendada (pg_cron, job limpeza-nonces-e-tentativas, a cada 30 min): apaga private.capture_request_nonces com mais de 24h (validade real do nonce: 12h). Backstop da limpeza que submit_capture_request/submit_landing_lead já fazem a cada envio aceito. Retorna quantas linhas apagou.';

revoke all on function private.cleanup_expired_nonces() from public, anon, authenticated;

-- Tentativas/rate limit da captação (submit_capture_request) e das landing
-- pages (submit_landing_lead); a janela real do limite é de minutos.
create or replace function private.cleanup_stale_rate_limit_attempts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_count integer;
begin
  delete from private.capture_request_attempts
  where created_at < now() - interval '2 days';
  get diagnostics v_deleted = row_count;

  delete from private.landing_lead_attempts
  where created_at < now() - interval '2 days';
  get diagnostics v_count = row_count;

  return v_deleted + v_count;
end;
$$;

comment on function private.cleanup_stale_rate_limit_attempts() is
  'Rotina agendada (pg_cron, job limpeza-nonces-e-tentativas, a cada 30 min): apaga private.capture_request_attempts e private.landing_lead_attempts com mais de 2 dias (janela real do limite de taxa: minutos). Backstop da limpeza que as próprias RPCs já fazem a cada envio aceito. Retorna quantas linhas apagou (soma das duas tabelas).';

revoke all on function private.cleanup_stale_rate_limit_attempts() from public, anon, authenticated;

-- Convites NÃO aceitos e vencidos há muito tempo. Convites aceitos
-- (accepted_at preenchido) nunca são apagados por esta função.
create or replace function private.cleanup_expired_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.invitations
  where accepted_at is null
    and expires_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function private.cleanup_expired_invitations() is
  'Rotina agendada (pg_cron, job limpeza-convites-expirados, diário às 03:17 UTC): apaga public.invitations NÃO aceitos (accepted_at is null) cujo expires_at passou há mais de 30 dias. Convites aceitos nunca são apagados por esta função. Retorna quantas linhas apagou.';

revoke all on function private.cleanup_expired_invitations() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Agendamento (idempotente: reagenda do zero se o job já existir).
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'limpeza-nonces-e-tentativas') then
    perform cron.unschedule('limpeza-nonces-e-tentativas');
  end if;
end;
$$;

select cron.schedule(
  'limpeza-nonces-e-tentativas',
  '*/30 * * * *',
  $cron$
    select private.cleanup_expired_nonces();
    select private.cleanup_stale_rate_limit_attempts();
  $cron$
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'limpeza-convites-expirados') then
    perform cron.unschedule('limpeza-convites-expirados');
  end if;
end;
$$;

select cron.schedule(
  'limpeza-convites-expirados',
  '17 3 * * *',
  $cron$ select private.cleanup_expired_invitations(); $cron$
);
