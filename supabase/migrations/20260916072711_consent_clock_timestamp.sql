-- Ordem do consentimento vigente: relógio de parede, não relógio da transação.
--
-- `now()` devolve o instante de INÍCIO da transação e é igual para tudo que
-- acontece dentro dela. Nas duas tabelas abaixo isso quebra duas regras que
-- dependem de ordem estrita:
--
--   1. `private.consent_active` decide pelo ÚLTIMO registro daquele titular,
--      finalidade e canal. Se um webhook gravar revogação e consentimento no
--      mesmo pedido (acontece: `user_preferences` com `resume` grava o
--      consentimento e libera a supressão), os dois ficariam com o mesmo
--      `collected_at` e o desempate cairia no `id`, que é um uuid aleatório —
--      ou seja, o estado vigente viraria sorteio.
--   2. `public.release_whatsapp_suppression` exige consentimento registrado
--      DEPOIS da supressão (`cr.collected_at > s.created_at`). Com o mesmo
--      instante nos dois, a comparação é falsa e a liberação legítima seria
--      recusada.
--
-- `clock_timestamp()` avança dentro da transação e resolve os dois casos. Não
-- há linha para corrigir: as tabelas nasceram nesta entrega.

alter table public.consent_records
  alter column collected_at set default clock_timestamp();

alter table public.whatsapp_suppressions
  alter column created_at set default clock_timestamp();

comment on column public.consent_records.collected_at is
  'Momento do registro, por clock_timestamp(): avança dentro da transação, para a ordem do estado vigente nunca depender de desempate por uuid.';
comment on column public.whatsapp_suppressions.created_at is
  'Momento da supressão, por clock_timestamp(): a liberação exige consentimento com collected_at estritamente maior que este valor.';
