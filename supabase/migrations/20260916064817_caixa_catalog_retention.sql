-- =============================================================================
-- Expurgo do catálogo da Caixa na manutenção agendada (pg_cron)
-- =============================================================================
-- `public.caixa_listings` nunca apaga linha: quem some do arquivo da Caixa
-- recebe `saiu_da_lista_em` e fica. Sem rotina de limpeza, imóvel que saiu há
-- meses permanece para sempre. Esta migração fecha isso, no molde das outras
-- rotinas de 20260915090851_scheduled_maintenance.sql e 20260915112227.
--
-- Duas proteções, e as duas são de propósito:
--
--   1. O filtro exige que o imóvel NÃO esteja em `caixa_favorites` nem em
--      `caixa_client_links`. Um imóvel que saiu do leilão mas que algum
--      corretor favoritou ou ligou a um cliente continua existindo — senão o
--      favorito dele viraria um buraco.
--   2. As FKs dessas duas tabelas são `on delete restrict`. Se o filtro acima
--      estiver errado por qualquer motivo, o delete **falha alto** (23503) em
--      vez de destruir dado de usuário em silêncio. Nenhum `exception when` é
--      colocado aqui de propósito: falha tem que aparecer em
--      `cron.job_run_details`, não ser engolida.
--
-- Por que `security definer` é necessário e não só conveniente: as duas
-- verificações de `not exists` precisam enxergar favoritos e vínculos de TODAS
-- as imobiliárias. Sob RLS, a função veria zero linhas das outras e concluiria
-- que ninguém favoritou — tentaria apagar, e a FK derrubaria a limpeza inteira.
-- Rodando como dona das tabelas, a leitura é completa e o filtro é verdadeiro.

-- -----------------------------------------------------------------------------
-- 1. Índice para a varredura do expurgo
-- -----------------------------------------------------------------------------
-- Parcial: só quem já saiu da lista é candidato, e esse é um subconjunto
-- pequeno do catálogo. Os índices existentes cobrem o caminho oposto
-- (`saiu_da_lista_em is null`), que é o da tela.
create index if not exists caixa_listings_expurgo_idx
  on public.caixa_listings (saiu_da_lista_em)
  where saiu_da_lista_em is not null;

-- -----------------------------------------------------------------------------
-- 2. Expurgo do catálogo
-- -----------------------------------------------------------------------------
create or replace function private.cleanup_old_caixa_listings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_retencao constant interval := interval '90 days';
  c_batch constant integer := 5000;
  c_max_batches constant integer := 100;
  v_deleted integer;
  v_total integer := 0;
  v_round integer := 0;
begin
  loop
    delete from public.caixa_listings l
    where l.numero in (
      select c.numero
      from public.caixa_listings c
      where c.saiu_da_lista_em < now() - c_retencao
        and not exists (
          select 1 from public.caixa_favorites f where f.numero = c.numero
        )
        and not exists (
          select 1 from public.caixa_client_links k where k.numero = c.numero
        )
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

comment on function private.cleanup_old_caixa_listings() is
  'Rotina agendada (pg_cron, job expurgo-caixa, domingo 05:11 UTC): apaga de public.caixa_listings quem saiu do arquivo da Caixa há mais de 90 dias e não é favorito nem está ligado a cliente de nenhuma imobiliária. Lotes de 5.000, até 100 por execução. As FKs de caixa_favorites e caixa_client_links são on delete restrict: filtro errado falha alto (23503) em vez de apagar dado de usuário. Retorna quantas linhas apagou.';

revoke all on function private.cleanup_old_caixa_listings() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Histórico da sincronização
-- -----------------------------------------------------------------------------
-- `caixa_sync_events` existe para medir a periodicidade real do arquivo da
-- Caixa, que hoje é palpite (um único ciclo observado). Por isso a retenção é
-- de DOIS ANOS e não dos 90 dias do catálogo: a função é agendada agora para
-- não ser esquecida, mas não pode apagar nada antes de 2028 — muito depois das
-- duas semanas de medição que a tabela precisa acumular. A tabela é minúscula
-- (uma linha por mudança e por falha), então guardar dois anos não custa nada.
create or replace function private.cleanup_old_caixa_sync_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.caixa_sync_events
  where ocorrido_em < now() - interval '2 years';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function private.cleanup_old_caixa_sync_events() is
  'Rotina agendada (pg_cron, job expurgo-caixa, domingo 05:11 UTC): apara public.caixa_sync_events com mais de 2 anos. Retenção longa de propósito — a tabela é a medição da periodicidade real do arquivo da Caixa. Retorna quantas linhas apagou.';

revoke all on function private.cleanup_old_caixa_sync_events() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Agendamento
-- -----------------------------------------------------------------------------
-- Domingo 05:11 UTC. Livre dos jobs existentes: limpeza-nonces-e-tentativas e
-- limpeza-ia (*/30, minutos 00 e 30), limpeza-convites-expirados (03:17),
-- retencao-auditoria (dom 04:23), limpeza-historico-cron (dom 04:47) e
-- rodizio-de-leads (a cada minuto).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expurgo-caixa') then
    perform cron.unschedule('expurgo-caixa');
  end if;
end;
$$;

select cron.schedule(
  'expurgo-caixa',
  '11 5 * * 0',
  $cron$
    select private.cleanup_old_caixa_listings();
    select private.cleanup_old_caixa_sync_events();
  $cron$
);
