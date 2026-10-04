-- =============================================================================
-- Teste dos limites de imóveis próprios e de fotos por imóvel
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- A imobiliária de teste usa limites curtos (2 imóveis próprios, 3 fotos cada)
-- só para o corte acontecer rápido. A regra que está sendo provada:
--
--   foto no NOSSO bucket (storage_path)  → ocupa espaço, conta nos dois limites
--   foto na origem (external_url)        → não ocupa nada, não conta em nada
--   imóvel vendido, alugado ou inativo   → sai da carteira, não ocupa vaga de
--                                          imóvel próprio (fotos por imóvel
--                                          continuam valendo)
--   voltar para rascunho/ativo/reservado → pede vaga de novo
--
-- Resultado esperado:
--   foto_1_imovel_a                          : "ok"
--   foto_3_imovel_a                          : "ok"
--   foto_4_imovel_a                          : "limite_photos_per_listing"
--   imovel_b_entra                           : "ok"
--   imovel_c_barrado                         : "limite_owned_listings"
--   imovel_c_importado_passa                 : "ok"
--   importado_nao_conta_no_imovel            : 0
--   importado_nao_conta_na_conta             : 2
--   apagar_libera_vaga                       : "ok"
--   video_externo_continua_valendo           : "ok"
--   vendido_nao_conta                        : 1
--   foto_em_imovel_ativo_com_vaga_liberada   : "ok"
--   foto_em_imovel_inativo_nao_ocupa_vaga    : "ok"
--   inativo_nao_conta                        : 2
--   foto_em_imovel_inativo_segue_limite      : "limite_photos_per_listing"
--   reativar_vendido_acima_do_limite         : "limite_owned_listings"
--   reativar_vendido_acima_do_limite_detalhe : {"limit": 2, "usage": 2}
--   reativacao_recusada_mantem_status        : "sold"
--   reativar_inativo_acima_do_limite         : "limite_owned_listings"
--   reativar_sem_foto_propria_passa          : "ok"
--   trocar_entre_status_que_contam_passa     : "ok"
--   alugado_nao_conta                        : 1
--   trocar_entre_status_que_nao_contam_passa : "ok"
--   reativar_com_vaga_passa                  : "ok"
--   conta_depois_de_reativar                 : 2

do $$
declare
  r jsonb := '{}'::jsonb;
  u_owner uuid := gen_random_uuid();
  org uuid;
  imovel_a uuid;
  imovel_b uuid;
  imovel_c uuid;
  imovel_d uuid;
  imovel_e uuid;
  i integer;
  -- 'ok' quando a operação passou; a mensagem do limite quando o gatilho barrou.
  resultado text;
  detalhe text;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'teste-imoveis-proprios@exemplo.invalid', now(), now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', u_owner, 'role', 'authenticated')::text, true);

  org := public.create_organization('Imobiliaria Teste Fotos', 'teste-imoveis-proprios');

  update public.billing_accounts
  set status = 'active',
      plan_key = 'imobiliaria',
      billing_interval = 'month',
      current_period_end = now() + interval '20 days',
      limits = limits || '{"owned_listings": 2, "photos_per_listing": 3}'::jsonb
  where organization_id = org;

  -- Preço e área já preenchidos: fora do rascunho o banco exige os dois, e o
  -- teste troca status.
  insert into public.properties (organization_id, title, purpose, type, sale_price, living_area)
  values (org, 'Imovel A', 'sale', 'apartment', 500000, 80) returning id into imovel_a;
  insert into public.properties (organization_id, title, purpose, type, sale_price, living_area)
  values (org, 'Imovel B', 'sale', 'apartment', 500000, 80) returning id into imovel_b;
  insert into public.properties (organization_id, title, purpose, type, sale_price, living_area)
  values (org, 'Imovel C', 'sale', 'apartment', 500000, 80) returning id into imovel_c;
  insert into public.properties (organization_id, title, purpose, type, sale_price, living_area)
  values (org, 'Imovel D', 'sale', 'apartment', 500000, 80) returning id into imovel_d;
  insert into public.properties (organization_id, title, purpose, type, sale_price, living_area)
  values (org, 'Imovel E', 'sale', 'apartment', 500000, 80) returning id into imovel_e;

  -- ---------------------------------------------------------------------------
  -- 1. Fotos por imóvel
  -- ---------------------------------------------------------------------------
  for i in 1..3 loop
    begin
      insert into public.property_media (organization_id, property_id, kind, storage_path, position)
      values (org, imovel_a, 'image',
              org::text || '/properties/' || imovel_a::text || '/a' || i || '.webp', i);
      resultado := 'ok';
    exception when others then
      resultado := sqlerrm;
    end;

    if i = 1 then
      r := r || jsonb_build_object('foto_1_imovel_a', resultado);
    elsif i = 3 then
      r := r || jsonb_build_object('foto_3_imovel_a', resultado);
    end if;
  end loop;

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel_a, 'image',
            org::text || '/properties/' || imovel_a::text || '/a4.webp', 4);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('foto_4_imovel_a', resultado);

  -- ---------------------------------------------------------------------------
  -- 2. Imóveis próprios
  -- ---------------------------------------------------------------------------
  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel_b, 'image',
            org::text || '/properties/' || imovel_b::text || '/b1.webp', 1);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('imovel_b_entra', resultado);

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel_c, 'image',
            org::text || '/properties/' || imovel_c::text || '/c1.webp', 1);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('imovel_c_barrado', resultado);

  -- ---------------------------------------------------------------------------
  -- 3. Foto importada: entra mesmo com os dois limites cheios, e não conta
  -- ---------------------------------------------------------------------------
  begin
    insert into public.property_media (organization_id, property_id, kind, external_url, position)
    values (org, imovel_c, 'image', 'https://origem.invalid/fotos/c1.jpg', 1);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('imovel_c_importado_passa', resultado);

  r := r || jsonb_build_object(
    'importado_nao_conta_no_imovel', private.owned_photo_count(imovel_c),
    'importado_nao_conta_na_conta', private.owned_listing_count(org));

  -- ---------------------------------------------------------------------------
  -- 4. Apagar foto devolve a vaga
  -- ---------------------------------------------------------------------------
  delete from public.property_media
  where property_id = imovel_a
    and storage_path = org::text || '/properties/' || imovel_a::text || '/a3.webp';

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel_a, 'image',
            org::text || '/properties/' || imovel_a::text || '/a5.webp', 5);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('apagar_libera_vaga', resultado);

  -- ---------------------------------------------------------------------------
  -- 5. Vídeo externo não foi afetado pela mudança da restrição
  -- ---------------------------------------------------------------------------
  begin
    insert into public.property_media (organization_id, property_id, kind, external_url, position)
    values (org, imovel_c, 'video', 'https://youtu.be/exemplo', 2);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('video_externo_continua_valendo', resultado);

  -- ---------------------------------------------------------------------------
  -- 6. Imóvel que saiu da carteira não ocupa vaga
  -- ---------------------------------------------------------------------------
  -- Aqui: A (rascunho, 3 fotos próprias) e B (rascunho, 1 foto própria) ocupam
  -- as 2 vagas; C só tem foto importada.
  update public.properties set status = 'sold' where id = imovel_b;
  r := r || jsonb_build_object('vendido_nao_conta', private.owned_listing_count(org));

  -- A vaga que B liberou serve para a primeira foto própria de C, já ativo.
  update public.properties set status = 'active' where id = imovel_c;

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel_c, 'image',
            org::text || '/properties/' || imovel_c::text || '/c2.webp', 3);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('foto_em_imovel_ativo_com_vaga_liberada', resultado);

  -- Vagas cheias de novo (A e C). D inativo recebe fotos próprias sem pedir vaga,
  -- mas o limite de fotos por imóvel continua valendo para ele.
  update public.properties set status = 'inactive' where id = imovel_d;

  for i in 1..3 loop
    begin
      insert into public.property_media (organization_id, property_id, kind, storage_path, position)
      values (org, imovel_d, 'image',
              org::text || '/properties/' || imovel_d::text || '/d' || i || '.webp', i);
      resultado := 'ok';
    exception when others then
      resultado := sqlerrm;
    end;

    if i = 1 then
      r := r || jsonb_build_object('foto_em_imovel_inativo_nao_ocupa_vaga', resultado);
    end if;
  end loop;

  r := r || jsonb_build_object('inativo_nao_conta', private.owned_listing_count(org));

  begin
    insert into public.property_media (organization_id, property_id, kind, storage_path, position)
    values (org, imovel_d, 'image',
            org::text || '/properties/' || imovel_d::text || '/d4.webp', 4);
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('foto_em_imovel_inativo_segue_limite', resultado);

  -- ---------------------------------------------------------------------------
  -- 7. Voltar para a carteira pede vaga
  -- ---------------------------------------------------------------------------
  -- Vagas cheias (A rascunho, C ativo). B vendido e D inativo têm foto própria.
  detalhe := null;
  begin
    update public.properties set status = 'active' where id = imovel_b;
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
    get stacked diagnostics detalhe = pg_exception_detail;
  end;
  r := r || jsonb_build_object(
    'reativar_vendido_acima_do_limite', resultado,
    'reativar_vendido_acima_do_limite_detalhe', detalhe::jsonb,
    'reativacao_recusada_mantem_status',
      (select p.status from public.properties p where p.id = imovel_b));

  begin
    update public.properties set status = 'reserved' where id = imovel_d;
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('reativar_inativo_acima_do_limite', resultado);

  -- E inativo só com foto importada: não ocupa vaga, então volta mesmo no limite.
  insert into public.property_media (organization_id, property_id, kind, external_url, position)
  values (org, imovel_e, 'image', 'https://origem.invalid/fotos/e1.jpg', 1);
  update public.properties set status = 'inactive' where id = imovel_e;

  begin
    update public.properties set status = 'active' where id = imovel_e;
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('reativar_sem_foto_propria_passa', resultado);

  -- Ativo → reservado: continua na carteira, não pede vaga nova.
  begin
    update public.properties set status = 'reserved' where id = imovel_c;
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('trocar_entre_status_que_contam_passa', resultado);

  -- A alugado libera uma vaga.
  update public.properties set status = 'rented' where id = imovel_a;
  r := r || jsonb_build_object('alugado_nao_conta', private.owned_listing_count(org));

  -- Alugado → vendido: continua fora da carteira, nada a checar.
  begin
    update public.properties set status = 'sold' where id = imovel_a;
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object('trocar_entre_status_que_nao_contam_passa', resultado);

  -- Com a vaga de A, B vendido volta a ativo.
  begin
    update public.properties set status = 'active' where id = imovel_b;
    resultado := 'ok';
  exception when others then
    resultado := sqlerrm;
  end;
  r := r || jsonb_build_object(
    'reativar_com_vaga_passa', resultado,
    'conta_depois_de_reativar', private.owned_listing_count(org));

  raise exception using errcode = 'P0001', message = jsonb_pretty(r);
end;
$$;
