-- =============================================================================
-- Remove índices redundantes (duplicados ou prefixo de um índice único)
-- =============================================================================
-- Performance Advisor, lint 0005 (unused_index):
-- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index
--
-- O banco quase não tem tráfego, então "nunca usado" não prova nada: os índices
-- de chave estrangeira e os de busca/ordenação das telas ficam. Saem só os que
-- têm outro índice com as MESMAS colunas iniciais, sem predicado parcial, e que
-- continua cobrindo a chave estrangeira (prova em pg_indexes e
-- pg_stat_user_indexes, no README):
--
--   whatsapp_channels_organization_idx (organization_id), 0 leituras
--     → whatsapp_channels_organization_id_id_key (organization_id, id)
--   connected_accounts_organization_idx (organization_id, provider): duplicado
--     → connected_accounts_organization_provider_key (organization_id, provider)
--   lead_routing_shifts_member_weekday_idx (member_id, weekday, start_minute): duplicado
--     → lead_routing_shifts_member_weekday_key (member_id, weekday, start_minute)
--   lead_integrations_organization_idx (organization_id)
--     → lead_integrations_organization_provider_key (organization_id, provider)
--   commission_shares_commission_idx (commission_id)
--     → commission_shares_role_key (commission_id, role)
--   whatsapp_conversations_channel_idx (organization_id, channel_id)
--     → whatsapp_conversations_channel_contact_key (organization_id, channel_id, contact_wa_id)
--
-- O bloco confere que o índice que fica existe, é válido, não é parcial e começa
-- pelas mesmas colunas; se não, nada é removido. No fim, nenhuma chave
-- estrangeira de public/private pode ficar sem índice que comece por ela.
-- =============================================================================

do $$
declare
  v_pair record;
  v_uncovered text;
begin
  for v_pair in
    select * from (values
      ('whatsapp_channels_organization_idx', 'whatsapp_channels_organization_id_id_key'),
      ('connected_accounts_organization_idx', 'connected_accounts_organization_provider_key'),
      ('lead_routing_shifts_member_weekday_idx', 'lead_routing_shifts_member_weekday_key'),
      ('lead_integrations_organization_idx', 'lead_integrations_organization_provider_key'),
      ('commission_shares_commission_idx', 'commission_shares_role_key'),
      ('whatsapp_conversations_channel_idx', 'whatsapp_conversations_channel_contact_key')
    ) as t(dropped, kept)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_index d
      join pg_catalog.pg_class dc on dc.oid = d.indexrelid
      join pg_catalog.pg_namespace dn on dn.oid = dc.relnamespace
      join pg_catalog.pg_index k on k.indrelid = d.indrelid
      join pg_catalog.pg_class kc on kc.oid = k.indexrelid
      where dn.nspname = 'public'
        and dc.relname = v_pair.dropped
        and kc.relname = v_pair.kept
        and k.indisvalid
        and k.indpred is null
        and k.indexprs is null
        and d.indexprs is null
        and kc.relam = dc.relam
        and d.indnkeyatts <= k.indnkeyatts
        and ((d.indkey::int2[])[0:d.indnkeyatts - 1])::int2[]
          = ((k.indkey::int2[])[0:d.indnkeyatts - 1])::int2[]
    ) then
      raise exception 'Índice % não é coberto por %: nada foi removido.', v_pair.dropped, v_pair.kept;
    end if;

    execute format('drop index public.%I', v_pair.dropped);
  end loop;

  select string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ')
    into v_uncovered
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and n.nspname in ('public', 'private')
    and not exists (
      select 1
      from pg_catalog.pg_index i
      where i.indrelid = con.conrelid
        and i.indisvalid
        and i.indnkeyatts >= cardinality(con.conkey)
        and ((i.indkey::int2[])[0:cardinality(con.conkey) - 1])::int2[] = con.conkey::int2[]
    );

  if v_uncovered is not null then
    raise exception 'Chave estrangeira sem índice depois da limpeza: %', v_uncovered;
  end if;
end;
$$;
