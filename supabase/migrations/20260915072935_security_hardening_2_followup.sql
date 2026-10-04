-- =============================================================================
-- 1210 - Endurecimento 2 (complemento): tarefas/visitas e uploads órfãos
-- =============================================================================
-- Complemento de security_hardening_2 (itens pedidos depois que ela já estava
-- aplicada no projeto remoto).
--  1. tasks / appointments: trocar o cliente vinculado exige acesso a ele
--  2. Storage client-documents: autor apaga o próprio upload enquanto não houver
--     registro em public.client_documents

-- -----------------------------------------------------------------------------
-- 1. tasks / appointments
-- -----------------------------------------------------------------------------
-- Os INSERTs já exigem acesso ao cliente; no UPDATE, um corretor podia trocar o
-- client_id da própria tarefa/visita para um cliente de outro corretor (e assim
-- ligar a agenda dele a fichas que não vê).
-- A checagem é feita por trigger, só quando client_id muda: num WITH CHECK da
-- política ela valeria para qualquer edição e impediria o responsável pela
-- tarefa (ou o corretor da visita agendada pela gestão) de concluí-la quando
-- não tem acesso ao cliente vinculado.
create or replace function private.enforce_client_access_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is not null
     and new.client_id is distinct from old.client_id
     and (select auth.uid()) is not null then
    if not private.can_access_client(new.client_id) then
      raise exception 'Você não tem acesso ao cliente escolhido.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_client_access_on_change() from public;

create trigger tasks_enforce_client_access
  before update of client_id on public.tasks
  for each row execute function private.enforce_client_access_on_change();

create trigger appointments_enforce_client_access
  before update of client_id on public.appointments
  for each row execute function private.enforce_client_access_on_change();

-- -----------------------------------------------------------------------------
-- 2. Storage client-documents: limpeza de upload órfão pelo autor
-- -----------------------------------------------------------------------------
-- Quando o arquivo sobe mas o registro em client_documents falha, o app apaga o
-- arquivo. Antes só dono/gerente podiam apagar, e sobrava arquivo órfão.
-- O autor do upload (storage.objects.owner_id, preenchido pelo Storage com o
-- usuário do JWT) pode apagar SOMENTE enquanto não houver documento registrado
-- com esse caminho; documento registrado continua sendo apagado só por dono e
-- gerente. A checagem de registro ignora o RLS (quem perdeu acesso ao cliente
-- não pode apagar documento registrado por "não enxergar" a linha).
create or replace function private.client_document_is_registered(p_storage_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.client_documents d
    where d.storage_path = p_storage_path
  );
$$;

revoke all on function private.client_document_is_registered(text) from public;
grant execute on function private.client_document_is_registered(text) to authenticated;

create policy "client-documents: autor remove envio sem registro"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and owner_id = (select auth.uid())::text
    and private.is_member(private.try_uuid((storage.foldername(name))[1]))
    and not private.client_document_is_registered(name)
  );
