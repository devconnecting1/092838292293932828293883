-- =============================================================================
-- Lixeira: deduplicação ignora o que está na lixeira
-- =============================================================================
-- Complemento de 20260917122657_trash_bin_and_subject_erasure. Funções security
-- definer que procuram duplicados não podem casar com registro na lixeira:
--  * private.ingest_external_lead_row: lead repetido do portal em 24 h caía
--    dentro do lead excluído (sumia da tela); o código do anúncio também não
--    liga o lead a imóvel na lixeira.
--  * private.import_find_client/lead/property: a importação de planilha
--    atualizava o registro excluído em vez de criar um novo.
--  * public.lead_duplicate_flags: o selo "possível duplicado" não aponta para
--    lead ou cliente na lixeira.
-- Mesma técnica da migração anterior: troca de trecho exato na definição atual,
-- falhando se o trecho sumir.
-- =============================================================================

do $patch$
declare
  v_patch record;
  v_def text;
begin
  for v_patch in
    select t.fn, t.from_text, t.to_text
    from (
      values
        (1, 'private.ingest_external_lead_row(uuid, public.lead_integration_provider, jsonb)',
          'and l.created_at > now() - interval ''24 hours''',
          'and l.created_at > now() - interval ''24 hours'' and l.deleted_at is null'),
        (2, 'private.ingest_external_lead_row(uuid, public.lead_integration_provider, jsonb)',
          'and upper(p.code) = upper(v_listing)',
          'and upper(p.code) = upper(v_listing) and p.deleted_at is null'),
        (3, 'private.import_find_client(uuid, text, text, text[])',
          'where c.organization_id = p_organization_id',
          'where c.organization_id = p_organization_id and c.deleted_at is null'),
        (4, 'private.import_find_lead(uuid, text, text)',
          'where l.organization_id = p_organization_id',
          'where l.organization_id = p_organization_id and l.deleted_at is null'),
        (5, 'private.import_find_property(uuid, jsonb)',
          'where p.organization_id = p_organization_id',
          'where p.organization_id = p_organization_id and p.deleted_at is null'),
        (6, 'public.lead_duplicate_flags(uuid[])',
          'and d.id <> l.id',
          'and d.id <> l.id and d.deleted_at is null'),
        (7, 'public.lead_duplicate_flags(uuid[])',
          'and c.id is distinct from l.client_id',
          'and c.id is distinct from l.client_id and c.deleted_at is null')
    ) as t(ord, fn, from_text, to_text)
    order by t.ord
  loop
    v_def := pg_get_functiondef(v_patch.fn::regprocedure);

    if strpos(v_def, v_patch.from_text) = 0 then
      raise exception 'Trecho não encontrado em %: %', v_patch.fn, v_patch.from_text;
    end if;

    if strpos(v_def, v_patch.to_text) > 0 then
      raise exception 'Função % já tem o filtro: %', v_patch.fn, v_patch.to_text;
    end if;

    execute replace(v_def, v_patch.from_text, v_patch.to_text);
  end loop;
end
$patch$;
