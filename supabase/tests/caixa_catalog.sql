-- =============================================================================
-- Teste do catálogo de imóveis da Caixa (compartilhado) e do que é por tenant
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado:
--   1. o catálogo é o MESMO para todo assinante (a imobiliária B lê os imóveis
--      carregados antes de ela existir);
--   2. favorito e vínculo NÃO são: B não enxerga nem conta os de A;
--   3. quem escreve o catálogo é só a RPC com a chave do Vault — sessão de
--      usuário não grava nem pela tabela nem pela RPC sem a chave;
--   4. imóvel que sai do arquivo é MARCADO, nunca apagado, e o favorito de A
--      continua de pé;
--   5. carga truncada não zera o catálogo;
--   6. a verificação de 30 em 30 minutos que NÃO muda nada (304 Not Modified)
--      só conta, não toca em imóvel nenhum, e o `Last-Modified` guardado é o
--      que vai como `If-Modified-Since` na verificação seguinte.
--
-- Resultado esperado (ordem das chaves pode variar):
--   carga_com_chave                : {"received":1002,"accepted":1002,"inserted":1002,"updated":0,"rejected":0}
--   carga_sem_chave                : "NEGADO:42501"
--   carga_com_chave_errada         : "NEGADO:42501"
--   fechamento_sem_chave           : "NEGADO:42501"
--   fechamento_carga_curta         : "NEGADO:22023"
--   b_le_catalogo                  : 1002
--   b_le_favoritos_de_a            : 0
--   b_le_vinculos_de_a             : 0
--   b_grava_no_catalogo            : "NEGADO:42501"
--   b_altera_o_catalogo            : "NEGADO:42501"
--   b_apaga_do_catalogo            : "NEGADO:42501"
--   b_favorita_no_nome_de_a        : "NEGADO:42501"
--   b_favorita_para_si             : "ok"
--   b_vincula_cliente_de_a         : "NEGADO:42501"
--   b_chama_rpc_sem_chave          : "NEGADO:42501"
--   a_le_o_proprio_favorito        : 1
--   a_le_o_proprio_vinculo         : 1
--   a_busca_por_trecho             : 1
--   saiu_da_lista_marcado          : 1
--   saiu_da_lista_apagado          : 0
--   favorito_sobrevive_ao_sumico   : 1
--   catalogo_ativo_depois          : 1001
--   estado_sem_chave               : "NEGADO:42501"
--   check_sem_chave                : "NEGADO:42501"
--   check_resultado_invalido       : "NEGADO:22023"
--   verificacoes_sem_mudanca       : 2
--   catalogo_intacto_apos_304      : 1002
--   verificacoes_zeradas_na_mudanca: 0
--   last_modified_guardado         : "Wed, 16 Sep 2026 01:00:25 GMT"
--   eventos_de_mudanca             : 2

do $$
declare
  r jsonb := '{}'::jsonb;
  u_a uuid := gen_random_uuid();  -- dono da imobiliária A
  u_b uuid := gen_random_uuid();  -- dono da imobiliária B (outra empresa)
  org_a uuid;
  org_b uuid;
  cliente_a uuid;
  key text;
  sync_1 uuid := gen_random_uuid();
  sync_2 uuid := gen_random_uuid();
  numero_favorito constant text := '8787709515913';
  linhas jsonb;
  n integer;
  j jsonb;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'caixa_server_key';

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (u_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-caixa-a@exemplo.invalid', now(), now()),
    (u_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'teste-caixa-b@exemplo.invalid', now(), now());

  -- ---------------------------------------------------------------------------
  -- 1. Carga do catálogo: só com a chave do Vault
  -- ---------------------------------------------------------------------------
  -- 1.000 imóveis sintéticos (o piso de finish_caixa_sync) + 2 registros reais.
  select jsonb_agg(jsonb_build_object(
    'numero', (1000000000000 + i)::text,
    'uf', 'SP',
    'cidade', 'Sao Paulo',
    'bairro', 'Centro',
    'endereco', 'RUA DE TESTE, N. ' || i,
    'preco', 100000 + i,
    'valor_avaliacao', 120000 + i,
    'desconto', 10.5,
    'aceita_financiamento', false,
    'descricao', 'Apartamento, 70.00 de area total',
    'modalidade', 'Venda Online',
    'link', 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel='
            || (1000000000000 + i)::text,
    'tipo', 'apartment',
    'area_total', 70,
    'quartos', 2,
    'vagas', 1
  ))
  into linhas
  from generate_series(1, 1000) as i;

  linhas := linhas || jsonb_build_array(
    jsonb_build_object(
      'numero', numero_favorito,
      'uf', 'ES', 'cidade', 'Cariacica', 'bairro', 'Tucum',
      'endereco', 'RUA SAO PAULO APOSTOLO, N. 23, Apto 402',
      'preco', 134287.99, 'valor_avaliacao', 222179, 'desconto', 39.56,
      'aceita_financiamento', true,
      'descricao', 'Apartamento, 74.12 de area total, 2 qto(s), 1 vaga(s) de garagem.',
      'modalidade', 'Licitacao Aberta',
      'link', 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel='
              || numero_favorito,
      'tipo', 'apartment', 'area_total', 74.12, 'quartos', 2, 'vagas', 1),
    -- Este some do arquivo na 2ª carga.
    jsonb_build_object(
      'numero', '1555518212585',
      'uf', 'AC', 'cidade', 'Bujari', 'bairro', 'Centro',
      'endereco', 'RUA PROJETADA 2, N. SN, LT 19 QD B',
      'preco', 170000, 'valor_avaliacao', 170000, 'desconto', 0,
      'aceita_financiamento', false,
      'descricao', 'Casa, 360.00 de area do terreno.',
      'modalidade', 'Leilao SFI - Edital Unico',
      'link', 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1555518212585',
      'tipo', 'house', 'area_terreno', 360)
  );

  r := r || jsonb_build_object(
    'carga_com_chave', public.ingest_caixa_listings(key, sync_1, date '2026-09-15', linhas));

  begin
    perform public.ingest_caixa_listings(null, sync_1, date '2026-09-15', '[]'::jsonb);
    r := r || jsonb_build_object('carga_sem_chave', 'PERMITIDA');
  exception when others then
    r := r || jsonb_build_object('carga_sem_chave', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.ingest_caixa_listings('chave-errada', sync_1, date '2026-09-15', '[]'::jsonb);
    r := r || jsonb_build_object('carga_com_chave_errada', 'PERMITIDA');
  exception when others then
    r := r || jsonb_build_object('carga_com_chave_errada', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.finish_caixa_sync(null, sync_1, date '2026-09-15', 0);
    r := r || jsonb_build_object('fechamento_sem_chave', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('fechamento_sem_chave', 'NEGADO:' || sqlstate);
  end;

  -- Carga que só viu um punhado de imóveis não pode marcar o resto como saído.
  begin
    perform public.finish_caixa_sync(key, gen_random_uuid(), date '2026-09-15', 0);
    r := r || jsonb_build_object('fechamento_carga_curta', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('fechamento_carga_curta', 'NEGADO:' || sqlstate);
  end;

  perform public.finish_caixa_sync(
    key, sync_1, date '2026-09-15', 0, 'Wed, 16 Sep 2026 01:00:25 GMT', null, null);

  -- ---------------------------------------------------------------------------
  -- 1b. Verificação condicional: 304 não mexe em nada
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'last_modified_guardado',
    public.get_caixa_sync_state(key) ->> 'source_last_modified');

  begin
    perform public.get_caixa_sync_state('chave-errada');
    r := r || jsonb_build_object('estado_sem_chave', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('estado_sem_chave', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.record_caixa_check('chave-errada', 'not_modified');
    r := r || jsonb_build_object('check_sem_chave', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('check_sem_chave', 'NEGADO:' || sqlstate);
  end;

  begin
    perform public.record_caixa_check(key, 'inventado');
    r := r || jsonb_build_object('check_resultado_invalido', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('check_resultado_invalido', 'NEGADO:' || sqlstate);
  end;

  perform public.record_caixa_check(key, 'not_modified');
  r := r || jsonb_build_object(
    'verificacoes_sem_mudanca',
    (public.record_caixa_check(key, 'not_modified') ->> 'checks_since_change')::integer,
    'catalogo_intacto_apos_304',
    (select count(*) from public.caixa_listings where saiu_da_lista_em is null));

  -- ---------------------------------------------------------------------------
  -- 2. Imobiliária A: favorita e vincula a um cliente da carteira
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);

  org_a := public.create_organization('Imobiliaria A', 'teste-caixa-a');

  insert into public.clients (organization_id, name, kind)
  values (org_a, 'Cliente da A', 'pf')
  returning id into cliente_a;

  insert into public.caixa_favorites (organization_id, user_id, numero)
  values (org_a, u_a, numero_favorito);

  insert into public.caixa_client_links (organization_id, numero, client_id)
  values (org_a, numero_favorito, cliente_a);

  -- ---------------------------------------------------------------------------
  -- 3. Imobiliária B: outra empresa, criada depois da carga
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_b, 'role', 'authenticated')::text, true);

  org_b := public.create_organization('Imobiliaria B', 'teste-caixa-b');

  set local role authenticated;

  execute 'select count(*) from public.caixa_listings' into n;
  r := r || jsonb_build_object('b_le_catalogo', n);

  execute 'select count(*) from public.caixa_favorites' into n;
  r := r || jsonb_build_object('b_le_favoritos_de_a', n);

  execute 'select count(*) from public.caixa_client_links' into n;
  r := r || jsonb_build_object('b_le_vinculos_de_a', n);

  begin
    execute 'insert into public.caixa_listings
               (numero, uf, cidade, endereco, preco, link, sincronizacao_id)
             values (''1'', ''SP'', ''Sao Paulo'', ''RUA X'', 1,
                     ''https://venda-imoveis.caixa.gov.br/x'', gen_random_uuid())';
    r := r || jsonb_build_object('b_grava_no_catalogo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('b_grava_no_catalogo', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'update public.caixa_listings set preco = 1';
    r := r || jsonb_build_object('b_altera_o_catalogo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('b_altera_o_catalogo', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'delete from public.caixa_listings';
    r := r || jsonb_build_object('b_apaga_do_catalogo', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('b_apaga_do_catalogo', 'NEGADO:' || sqlstate);
  end;

  -- Favoritar no nome de outra pessoa (mesmo sendo da própria imobiliária).
  begin
    execute 'insert into public.caixa_favorites (organization_id, user_id, numero)
             values ($1, $2, $3)' using org_b, u_a, numero_favorito;
    r := r || jsonb_build_object('b_favorita_no_nome_de_a', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('b_favorita_no_nome_de_a', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'insert into public.caixa_favorites (organization_id, user_id, numero)
             values ($1, $2, $3)' using org_b, u_b, numero_favorito;
    r := r || jsonb_build_object('b_favorita_para_si', 'ok');
  exception when others then
    r := r || jsonb_build_object('b_favorita_para_si', 'NEGADO:' || sqlstate);
  end;

  -- Vincular o imóvel a um cliente que é da imobiliária A.
  begin
    execute 'insert into public.caixa_client_links (organization_id, numero, client_id)
             values ($1, $2, $3)' using org_b, numero_favorito, cliente_a;
    r := r || jsonb_build_object('b_vincula_cliente_de_a', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('b_vincula_cliente_de_a', 'NEGADO:' || sqlstate);
  end;

  begin
    execute 'select public.ingest_caixa_listings(null, gen_random_uuid(), null, ''[]''::jsonb)';
    r := r || jsonb_build_object('b_chama_rpc_sem_chave', 'PERMITIDO');
  exception when others then
    r := r || jsonb_build_object('b_chama_rpc_sem_chave', 'NEGADO:' || sqlstate);
  end;

  reset role;

  -- ---------------------------------------------------------------------------
  -- 4. Sessão da imobiliária A: enxerga o que é dela
  -- ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', u_a, 'role', 'authenticated')::text, true);

  set local role authenticated;

  execute 'select count(*) from public.caixa_favorites' into n;
  r := r || jsonb_build_object('a_le_o_proprio_favorito', n);

  execute 'select count(*) from public.caixa_client_links' into n;
  r := r || jsonb_build_object('a_le_o_proprio_vinculo', n);

  execute 'select count(*) from public.search_caixa_listings($1, ''cariacica'')' into n using org_a;
  r := r || jsonb_build_object('a_busca_por_trecho', n);

  reset role;

  -- ---------------------------------------------------------------------------
  -- 5. Imóvel que some do arquivo é marcado, nunca apagado
  -- ---------------------------------------------------------------------------
  -- 2ª carga sem o imóvel de Bujari (1.001 dos 1.002).
  select jsonb_agg(l)
  into linhas
  from jsonb_array_elements(linhas) as l
  where l ->> 'numero' <> '1555518212585';

  perform public.ingest_caixa_listings(key, sync_2, date '2026-09-16', linhas);
  j := public.finish_caixa_sync(
    key, sync_2, date '2026-09-16', 0, 'Thu, 17 Sep 2026 01:00:11 GMT', null, null);

  select count(*) into n
  from public.caixa_listings
  where numero = '1555518212585'
    and saiu_da_lista_em is not null;
  r := r || jsonb_build_object('saiu_da_lista_marcado', n);

  select count(*) into n
  from public.caixa_listings
  where numero = '1555518212585';
  r := r || jsonb_build_object('saiu_da_lista_apagado', 1 - n);

  select count(*) into n
  from public.caixa_favorites
  where organization_id = org_a
    and numero = numero_favorito;
  r := r || jsonb_build_object('favorito_sobrevive_ao_sumico', n);

  r := r || jsonb_build_object(
    'catalogo_ativo_depois', (j ->> 'total')::integer,
    'verificacoes_zeradas_na_mudanca',
    (public.get_caixa_sync_state(key) ->> 'checks_since_change')::integer,
    'eventos_de_mudanca',
    (select count(*) from public.caixa_sync_events where resultado = 'ok'));

  raise exception using errcode = 'P0001', message = jsonb_pretty(r);
end;
$$;
