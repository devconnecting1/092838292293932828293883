-- Nome de modelo: tamanho fora da expressão regular.
--
-- A Meta aceita nome de template com até 512 caracteres, e a validação tinha
-- sido escrita como `~ '^[a-z0-9_]{1,512}$'`. O Postgres limita a contagem de
-- repetição de uma expressão regular a 255: acima disso ele nem compila e
-- devolve `2201B invalid repetition count(s)` na HORA DA EXECUÇÃO — a
-- restrição e a função foram criadas sem erro, e só o primeiro envio real
-- quebrava.
--
-- A correção separa as duas coisas: a expressão diz QUAIS caracteres valem, e
-- `char_length` diz QUANTOS. Mesma regra, sem o limite do motor de regex.

alter table public.whatsapp_messages
  drop constraint whatsapp_messages_template_name_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_template_name_check
  check (template_name ~ '^[a-z0-9_]+$' and char_length(template_name) <= 512);

create or replace function public.queue_whatsapp_message(
  p_conversation_id uuid,
  p_body text default null,
  p_template_name text default null,
  p_marketing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  c public.whatsapp_conversations;
  v_reason text;
  v_id uuid;
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
begin
  if v_user is null then
    raise exception 'É preciso estar autenticado.' using errcode = '42501';
  end if;

  select * into c from public.whatsapp_conversations where id = p_conversation_id;

  if c.id is null then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;

  if not private.can_access_whatsapp_conversation(c.organization_id, c.id) then
    raise exception 'Você não tem acesso a esta conversa.' using errcode = '42501';
  end if;

  if v_body is null and p_template_name is null then
    perform private.billing_invalid_field('p_body');
  end if;

  if v_body is not null and char_length(v_body) > 4096 then
    perform private.billing_invalid_field('p_body');
  end if;

  if p_template_name is not null
     and (p_template_name !~ '^[a-z0-9_]+$' or char_length(p_template_name) > 512) then
    perform private.billing_invalid_field('p_template_name');
  end if;

  v_reason := private.whatsapp_send_block_reason(
    c.id, coalesce(p_marketing, false), p_template_name is not null
  );

  if v_reason is not null then
    return jsonb_build_object('ok', false, 'reason', v_reason);
  end if;

  insert into public.whatsapp_messages
    (organization_id, conversation_id, direction, status, body, template_name, sent_by)
  values (c.organization_id, c.id, 'outbound', 'queued', v_body, p_template_name, v_user)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'message_id', v_id, 'status', 'queued');
end;
$$;

comment on function public.queue_whatsapp_message(uuid, text, text, boolean) is
  'Único caminho com sessão para enviar. Devolve {ok:false, reason} quando supressão, consentimento, janela de 24 h, número desligado ou conexão bloqueada impedem o envio — nunca enfileira mesmo assim.';
