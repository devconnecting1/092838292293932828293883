-- =============================================================================
-- Teste do Console da Plataforma: equipe (convites por e-mail e papéis)
-- =============================================================================
-- Bloco único, sem efeito no banco: cria os dados, confere tudo e termina com
-- `raise exception` — o resultado sai na mensagem do erro (P0001) e a transação
-- inteira é desfeita. Rode no SQL Editor do projeto ou por `psql -f`.
--
-- O que está sendo provado (migração platform_console_team):
--   1. sem PLATFORM_SERVER_KEY as nove RPCs recusam com 42501;
--   2. convidar grava só o hash do token e o registro; convidar o mesmo e-mail
--      de novo reenvia (não duplica), troca o token (o antigo para de valer) e
--      respeita 1 minuto entre envios;
--   3. e-mail, papel e hash fora do formato (22023) e convite para si mesmo
--      são recusados;
--   4. a prévia não traz o e-mail convidado e só diz se a conta logada casa;
--   5. aceite com conta de OUTRO e-mail e com e-mail NÃO confirmado é recusado
--      (42501); com a conta certa vira Somente leitura e grava o registro;
--   6. token reutilizado, expirado ou revogado é recusado;
--   7. Somente leitura não grava ação do console (42501 no registro) e ninguém
--      da equipe gerencia a equipe (42501 somente_dono);
--   8. mudar o papel e remover valem na consulta seguinte de platform_staff_role;
--      quem saiu pode voltar por um novo convite; trocar o e-mail da conta tira
--      o acesso;
--   9. travas: 20 convites pendentes e 30 envios em 24 horas;
--  10. as RPCs são só para anon e as tabelas não são legíveis com sessão.
--
-- Resultado esperado (ordem das chaves pode variar):
--   sem_chave                        : ["NEGADO:42501" x 9]
--   convite_criado                   : {"reenvio": false, "papel": "viewer", "hash_gravado": true}
--   convite_registrado               : 1
--   reenvio_rapido                   : "NEGADO:P0001:reenvio_muito_rapido"
--   reenvio                          : {"reenvio": true, "envios": 2, "um_so_convite": true}
--   token_antigo_sem_previa          : true
--   email_invalido                   : "NEGADO:22023:email_invalido"
--   papel_invalido                   : "NEGADO:22023:papel_invalido"
--   hash_invalido                    : "NEGADO:22023:token_invalido"
--   convite_para_si                  : "NEGADO:P0001:convite_para_si"
--   previa_publica                   : {"status": "valido", "role": "viewer", "sem_email": true}
--   previa_outra_conta               : false
--   previa_conta_certa               : {"casa": true, "confirmado": true}
--   aceite_outro_email               : "NEGADO:42501:email_diferente"
--   aceite_nao_confirmado            : "NEGADO:42501:email_nao_confirmado"
--   aceite_ok                        : {"papel": "viewer", "voltou": false, "papel_no_banco": "viewer"}
--   aceite_registrado                : true
--   token_reutilizado                : "NEGADO:P0001:convite_usado"
--   previa_usado                     : "usado"
--   leitura_nao_grava_acao           : "NEGADO:42501:somente_leitura"
--   leitura_nao_convida              : "NEGADO:42501:somente_dono"
--   convidar_quem_ja_e_da_equipe     : "NEGADO:P0001:ja_e_da_equipe"
--   mudar_papel                      : "admin"
--   admin_grava_acao                 : true
--   papel_igual                      : "NEGADO:P0001:papel_igual"
--   admin_nao_muda_papel             : "NEGADO:42501:somente_dono"
--   previa_expirado                  : "expirado"
--   token_expirado                   : "NEGADO:P0001:convite_expirado"
--   revogar                          : true
--   token_revogado                   : "NEGADO:P0001:convite_revogado"
--   revogar_de_novo                  : "NEGADO:P0001:convite_encerrado"
--   reenviar_revogado                : "NEGADO:P0001:convite_encerrado"
--   lista                            : {"donos": [...], "pessoas": 1, "convites": 2, "pendentes": 2}
--   remover                          : null
--   remover_de_novo                  : "NEGADO:P0002:membro_nao_encontrado"
--   voltar_para_a_equipe             : {"voltou": true, "papel": "viewer"}
--   sair_por_conta_propria           : null
--   email_trocado_perde_acesso       : null
--   limite_de_convites               : "NEGADO:P0001:limite_de_convites"
--   limite_diario                    : "NEGADO:P0001:limite_diario_de_envios"
--   rpcs_para_anon                   : true
--   rpcs_para_authenticated          : false
--   tabelas_para_anon                : false
--   tabelas_para_authenticated       : false

do $$
declare
  r jsonb := '{}'::jsonb;
  key text;
  u_owner uuid := gen_random_uuid();
  u_viewer uuid := gen_random_uuid();
  u_unconfirmed uuid := gen_random_uuid();
  u_other uuid := gen_random_uuid();
  u_admin uuid := gen_random_uuid();
  e_owner constant text := 'dono-equipe@exemplo.invalid';
  e_viewer constant text := 'leitura-equipe@exemplo.invalid';
  e_unconfirmed constant text := 'sem-confirmar-equipe@exemplo.invalid';
  e_other constant text := 'outra-conta-equipe@exemplo.invalid';
  e_admin constant text := 'admin-equipe@exemplo.invalid';
  h_v1 text := encode(extensions.digest('token-leitura-1', 'sha256'), 'hex');
  h_v2 text := encode(extensions.digest('token-leitura-2', 'sha256'), 'hex');
  h_v3 text := encode(extensions.digest('token-leitura-3', 'sha256'), 'hex');
  h_u text := encode(extensions.digest('token-sem-confirmar', 'sha256'), 'hex');
  h_a text := encode(extensions.digest('token-admin-1', 'sha256'), 'hex');
  h_a2 text := encode(extensions.digest('token-admin-2', 'sha256'), 'hex');
  v jsonb;
  v_list jsonb;
  v_invite_id uuid;
  v_admin_invite_id uuid;
  v_results jsonb := '[]'::jsonb;
  i integer;
begin
  select ds.decrypted_secret into key
  from vault.decrypted_secrets ds
  where ds.name = 'platform_server_key';

  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
  values
    (u_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e_owner, now(), now(), now()),
    (u_viewer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e_viewer, now(), now(), now()),
    (u_unconfirmed, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e_unconfirmed, null, now(), now()),
    (u_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e_other, now(), now(), now()),
    (u_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', e_admin, now(), now(), now());

  -- ---------------------------------------------------------------------------
  -- 1. Sem chave
  -- ---------------------------------------------------------------------------
  for i in 1..9 loop
    begin
      case i
        when 1 then perform public.platform_staff_role(null, u_viewer);
        when 2 then perform public.platform_staff_invite(null, u_owner, e_owner, e_viewer, 'viewer', h_v1);
        when 3 then perform public.platform_staff_resend_invitation(null, u_owner, e_owner, gen_random_uuid(), h_v1);
        when 4 then perform public.platform_staff_revoke_invitation(null, u_owner, e_owner, gen_random_uuid());
        when 5 then perform public.platform_staff_invitation_preview(null, h_v1, null);
        when 6 then perform public.platform_staff_accept_invitation('chave-errada', u_viewer, h_v1);
        when 7 then perform public.platform_staff_list(null, '{}'::text[]);
        when 8 then perform public.platform_staff_set_role(null, u_owner, e_owner, u_viewer, 'admin');
        else perform public.platform_staff_remove(null, u_owner, e_owner, u_viewer);
      end case;
      v_results := v_results || to_jsonb('PASSOU'::text);
    exception when sqlstate '42501' then
      v_results := v_results || to_jsonb('NEGADO:42501'::text);
    end;
  end loop;

  r := r || jsonb_build_object('sem_chave', v_results);

  -- ---------------------------------------------------------------------------
  -- 2. Convidar e reenviar
  -- ---------------------------------------------------------------------------
  v := public.platform_staff_invite(key, u_owner, 'Dono-Equipe@exemplo.invalid', ' Leitura-Equipe@Exemplo.invalid ', 'viewer', h_v1);
  v_invite_id := (v ->> 'invitation_id')::uuid;

  r := r || jsonb_build_object(
    'convite_criado', jsonb_build_object(
      'reenvio', (v ->> 'resent')::boolean,
      'papel', v ->> 'role',
      'hash_gravado', exists (
        select 1 from private.platform_staff_invitations x
        where x.id = v_invite_id and x.token_hash = h_v1 and x.email = e_viewer
      )
    ),
    'convite_registrado', (
      select count(*) from private.platform_audit_events e
      where e.action = 'equipe.convidar' and e.target_id = v_invite_id::text
    )
  );

  begin
    perform public.platform_staff_invite(key, u_owner, e_owner, e_viewer, 'viewer', h_v2);
    r := r || jsonb_build_object('reenvio_rapido', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('reenvio_rapido', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  update private.platform_staff_invitations x
  set last_sent_at = now() - interval '2 minutes'
  where x.id = v_invite_id;

  v := public.platform_staff_invite(key, u_owner, e_owner, e_viewer, 'viewer', h_v2);

  r := r || jsonb_build_object(
    'reenvio', jsonb_build_object(
      'reenvio', (v ->> 'resent')::boolean,
      'envios', (select x.send_count from private.platform_staff_invitations x where x.id = v_invite_id),
      'um_so_convite', (v ->> 'invitation_id')::uuid = v_invite_id
        and (select count(*) from private.platform_staff_invitations x where x.email = e_viewer) = 1
    ),
    'token_antigo_sem_previa', public.platform_staff_invitation_preview(key, h_v1, null) is null
  );

  -- ---------------------------------------------------------------------------
  -- 3. Validações
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_staff_invite(key, u_owner, e_owner, 'sem-arroba', 'viewer', h_a);
    r := r || jsonb_build_object('email_invalido', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('email_invalido', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_invite(key, u_owner, e_owner, e_admin, 'owner', h_a);
    r := r || jsonb_build_object('papel_invalido', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('papel_invalido', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_invite(key, u_owner, e_owner, e_admin, 'admin', 'token-sem-hash');
    r := r || jsonb_build_object('hash_invalido', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('hash_invalido', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_invite(key, u_owner, e_owner, e_owner, 'admin', h_a);
    r := r || jsonb_build_object('convite_para_si', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('convite_para_si', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 4. Prévia
  -- ---------------------------------------------------------------------------
  v := public.platform_staff_invitation_preview(key, h_v2, null);

  r := r || jsonb_build_object(
    'previa_publica', jsonb_build_object(
      'status', v ->> 'status',
      'role', v ->> 'role',
      'sem_email', not (v ? 'email') and v::text !~ '@'
    ),
    'previa_outra_conta',
    (public.platform_staff_invitation_preview(key, h_v2, u_other) ->> 'email_matches')::boolean
  );

  v := public.platform_staff_invitation_preview(key, h_v2, u_viewer);
  r := r || jsonb_build_object(
    'previa_conta_certa', jsonb_build_object(
      'casa', (v ->> 'email_matches')::boolean,
      'confirmado', (v ->> 'email_confirmed')::boolean
    )
  );

  -- ---------------------------------------------------------------------------
  -- 5. Aceite
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_staff_accept_invitation(key, u_other, h_v2);
    r := r || jsonb_build_object('aceite_outro_email', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('aceite_outro_email', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  perform public.platform_staff_invite(key, u_owner, e_owner, e_unconfirmed, 'admin', h_u);

  begin
    perform public.platform_staff_accept_invitation(key, u_unconfirmed, h_u);
    r := r || jsonb_build_object('aceite_nao_confirmado', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('aceite_nao_confirmado', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  v := public.platform_staff_accept_invitation(key, u_viewer, h_v2);

  r := r || jsonb_build_object(
    'aceite_ok', jsonb_build_object(
      'papel', v ->> 'role',
      'voltou', (v ->> 'rejoined')::boolean,
      'papel_no_banco', public.platform_staff_role(key, u_viewer)
    ),
    'aceite_registrado', exists (
      select 1 from private.platform_audit_events e
      where e.action = 'equipe.aceitar_convite'
        and e.actor_user_id = u_viewer
        and e.target_id = u_viewer::text
        and e.after_data ->> 'papel' = 'viewer'
    )
  );

  -- ---------------------------------------------------------------------------
  -- 6. Token reutilizado
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_staff_accept_invitation(key, u_viewer, h_v2);
    r := r || jsonb_build_object('token_reutilizado', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('token_reutilizado', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  r := r || jsonb_build_object(
    'previa_usado', public.platform_staff_invitation_preview(key, h_v2, null) ->> 'status'
  );

  -- ---------------------------------------------------------------------------
  -- 7. Somente leitura e gestão só do Dono
  -- ---------------------------------------------------------------------------
  begin
    perform public.platform_log_action(key, u_viewer, e_viewer, 'organizacao.bloquear');
    r := r || jsonb_build_object('leitura_nao_grava_acao', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('leitura_nao_grava_acao', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_invite(key, u_viewer, e_viewer, e_admin, 'admin', h_a);
    r := r || jsonb_build_object('leitura_nao_convida', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('leitura_nao_convida', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_invite(key, u_owner, e_owner, e_viewer, 'admin', h_a);
    r := r || jsonb_build_object('convidar_quem_ja_e_da_equipe', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('convidar_quem_ja_e_da_equipe', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 8. Mudar papel
  -- ---------------------------------------------------------------------------
  perform public.platform_staff_set_role(key, u_owner, e_owner, u_viewer, 'admin');

  r := r || jsonb_build_object(
    'mudar_papel', public.platform_staff_role(key, u_viewer),
    'admin_grava_acao',
    public.platform_log_action(key, u_viewer, e_viewer, 'organizacao.bloquear') is not null
  );

  begin
    perform public.platform_staff_set_role(key, u_owner, e_owner, u_viewer, 'admin');
    r := r || jsonb_build_object('papel_igual', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('papel_igual', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_set_role(key, u_viewer, e_viewer, u_viewer, 'viewer');
    r := r || jsonb_build_object('admin_nao_muda_papel', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('admin_nao_muda_papel', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 6b. Expirado e revogado
  -- ---------------------------------------------------------------------------
  v := public.platform_staff_invite(key, u_owner, e_owner, e_admin, 'admin', h_a);
  v_admin_invite_id := (v ->> 'invitation_id')::uuid;

  update private.platform_staff_invitations x
  set expires_at = now() - interval '1 minute'
  where x.id = v_admin_invite_id;

  r := r || jsonb_build_object(
    'previa_expirado', public.platform_staff_invitation_preview(key, h_a, null) ->> 'status'
  );

  begin
    perform public.platform_staff_accept_invitation(key, u_admin, h_a);
    r := r || jsonb_build_object('token_expirado', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('token_expirado', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  r := r || jsonb_build_object(
    'revogar',
    (public.platform_staff_revoke_invitation(key, u_owner, e_owner, v_admin_invite_id) ->> 'revoked_at') is not null
  );

  begin
    perform public.platform_staff_accept_invitation(key, u_admin, h_a);
    r := r || jsonb_build_object('token_revogado', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('token_revogado', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_revoke_invitation(key, u_owner, e_owner, v_admin_invite_id);
    r := r || jsonb_build_object('revogar_de_novo', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('revogar_de_novo', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  begin
    perform public.platform_staff_resend_invitation(key, u_owner, e_owner, v_admin_invite_id, h_a2);
    r := r || jsonb_build_object('reenviar_revogado', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('reenviar_revogado', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  -- Convite novo para a mesma pessoa depois do revogado (abre outro convite).
  perform public.platform_staff_invite(key, u_owner, e_owner, e_admin, 'viewer', h_a2);

  -- ---------------------------------------------------------------------------
  -- Lista
  -- ---------------------------------------------------------------------------
  v_list := public.platform_staff_list(key, array[e_owner, 'dono-sem-conta@exemplo.invalid']);

  r := r || jsonb_build_object(
    'lista', jsonb_build_object(
      'donos', v_list -> 'owners',
      'pessoas', jsonb_array_length(v_list -> 'members'),
      'pessoa_papel', v_list -> 'members' -> 0 ->> 'role',
      'pessoa_email_confere', (v_list -> 'members' -> 0 ->> 'account_email_matches')::boolean,
      'convites', jsonb_array_length(v_list -> 'invitations'),
      'pendentes', (v_list -> 'limits' ->> 'pending')::integer,
      'envios_24h', (v_list -> 'limits' ->> 'sends_last_24h')::integer
    )
  );

  -- ---------------------------------------------------------------------------
  -- 8b. Remover, voltar, sair e e-mail trocado
  -- ---------------------------------------------------------------------------
  perform public.platform_staff_remove(key, u_owner, e_owner, u_viewer);
  r := r || jsonb_build_object('remover', public.platform_staff_role(key, u_viewer));

  begin
    perform public.platform_staff_remove(key, u_owner, e_owner, u_viewer);
    r := r || jsonb_build_object('remover_de_novo', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('remover_de_novo', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  perform public.platform_staff_invite(key, u_owner, e_owner, e_viewer, 'viewer', h_v3);
  v := public.platform_staff_accept_invitation(key, u_viewer, h_v3);
  r := r || jsonb_build_object(
    'voltar_para_a_equipe', jsonb_build_object(
      'voltou', (v ->> 'rejoined')::boolean,
      'papel', public.platform_staff_role(key, u_viewer)
    )
  );

  perform public.platform_staff_accept_invitation(key, u_admin, h_a2);
  perform public.platform_staff_remove(key, u_admin, e_admin, u_admin);
  r := r || jsonb_build_object('sair_por_conta_propria', public.platform_staff_role(key, u_admin));

  update auth.users set email = 'trocado-equipe@exemplo.invalid' where id = u_viewer;
  r := r || jsonb_build_object('email_trocado_perde_acesso', public.platform_staff_role(key, u_viewer));

  -- ---------------------------------------------------------------------------
  -- 9. Travas
  -- ---------------------------------------------------------------------------
  -- Pendente agora: só o do e-mail não confirmado. Completa 20 e tenta o 21º.
  for i in 1..19 loop
    perform public.platform_staff_invite(
      key, u_owner, e_owner, format('pendente-%s@exemplo.invalid', i), 'viewer',
      encode(extensions.digest(format('token-pendente-%s', i), 'sha256'), 'hex'));
  end loop;

  begin
    perform public.platform_staff_invite(
      key, u_owner, e_owner, 'pendente-21@exemplo.invalid', 'viewer',
      encode(extensions.digest('token-pendente-21', 'sha256'), 'hex'));
    r := r || jsonb_build_object('limite_de_convites', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('limite_de_convites', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  -- Envios em 24 h até o teto (30) e mais um convite.
  while (
    select count(*) from private.platform_audit_events e
    where e.action in ('equipe.convidar', 'equipe.reenviar_convite')
      and e.occurred_at > now() - interval '24 hours'
  ) < 30 loop
    perform private.insert_platform_audit_event(u_owner, e_owner, 'equipe.reenviar_convite');
  end loop;

  perform public.platform_staff_revoke_invitation(
    key, u_owner, e_owner,
    (select x.id from private.platform_staff_invitations x where x.email = 'pendente-1@exemplo.invalid'));

  begin
    perform public.platform_staff_invite(
      key, u_owner, e_owner, 'pendente-22@exemplo.invalid', 'viewer',
      encode(extensions.digest('token-pendente-22', 'sha256'), 'hex'));
    r := r || jsonb_build_object('limite_diario', 'PASSOU');
  exception when others then
    r := r || jsonb_build_object('limite_diario', 'NEGADO:' || sqlstate || ':' || sqlerrm);
  end;

  -- ---------------------------------------------------------------------------
  -- 10. Privilégios
  -- ---------------------------------------------------------------------------
  r := r || jsonb_build_object(
    'rpcs_para_anon', (
      select bool_and(has_function_privilege('anon', f, 'execute'))
      from unnest(array[
        'public.platform_staff_role(text, uuid)',
        'public.platform_staff_invite(text, uuid, text, text, text, text)',
        'public.platform_staff_resend_invitation(text, uuid, text, uuid, text)',
        'public.platform_staff_revoke_invitation(text, uuid, text, uuid)',
        'public.platform_staff_invitation_preview(text, text, uuid)',
        'public.platform_staff_accept_invitation(text, uuid, text)',
        'public.platform_staff_list(text, text[])',
        'public.platform_staff_set_role(text, uuid, text, uuid, text)',
        'public.platform_staff_remove(text, uuid, text, uuid)'
      ]) as f
    ),
    'rpcs_para_authenticated', (
      select bool_or(has_function_privilege('authenticated', f, 'execute'))
      from unnest(array[
        'public.platform_staff_role(text, uuid)',
        'public.platform_staff_invite(text, uuid, text, text, text, text)',
        'public.platform_staff_resend_invitation(text, uuid, text, uuid, text)',
        'public.platform_staff_revoke_invitation(text, uuid, text, uuid)',
        'public.platform_staff_invitation_preview(text, text, uuid)',
        'public.platform_staff_accept_invitation(text, uuid, text)',
        'public.platform_staff_list(text, text[])',
        'public.platform_staff_set_role(text, uuid, text, uuid, text)',
        'public.platform_staff_remove(text, uuid, text, uuid)'
      ]) as f
    ),
    'tabelas_para_anon',
    has_table_privilege('anon', 'private.platform_staff', 'select')
      or has_table_privilege('anon', 'private.platform_staff_invitations', 'select'),
    'tabelas_para_authenticated',
    has_table_privilege('authenticated', 'private.platform_staff', 'select')
      or has_table_privilege('authenticated', 'private.platform_staff_invitations', 'select')
  );

  raise exception 'TESTE EQUIPE DO CONSOLE (rollback): %', r;
end;
$$;
