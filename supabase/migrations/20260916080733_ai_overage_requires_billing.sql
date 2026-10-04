-- Excedente de IA só pode existir quando houver como COBRÁ-LO.
--
-- Furo encontrado em 16/09/2026: `billing_accounts.ai_overage_cap_cents` aceitava
-- até R$ 5.000 e a RPC liberava gasto até esse valor — mas os add-ons de conversa
-- extra estão como "em breve" e **não existe preço na Stripe**. Ou seja: a
-- imobiliária autorizava a NOSSA empresa a gastar por ela. Dinheiro saindo sem
-- nota entrando, exatamente o prejuízo que o teto deveria impedir.
--
-- Enquanto não houver cobrança, o teto de excedente é zero e a IA para no teto
-- do plano. Espelho de AI_OVERAGE_BILLING_AVAILABLE = false no core.
--
-- Para ligar: criar os preços na Stripe, implementar a cobrança no fechamento do
-- ciclo, e então reverter este CHECK para `between 0 and 500000`.

-- Zera o que estiver gravado. Nenhum dado de negócio é perdido: é um limite.
update public.billing_accounts
set ai_overage_cap_cents = 0
where ai_overage_cap_cents <> 0;

alter table public.billing_accounts
  drop constraint if exists billing_accounts_ai_overage_cap_cents_check;

alter table public.billing_accounts
  add constraint billing_accounts_ai_overage_cap_cents_check
    check (ai_overage_cap_cents = 0);

comment on column public.billing_accounts.ai_overage_cap_cents is
  'Teto de excedente de IA do ciclo, em centavos. TRAVADO EM ZERO enquanto não houver cobrança do excedente (add-ons "em breve", sem preço na Stripe): liberar gasto sem receita seria prejuízo por construção. Espelho de AI_OVERAGE_BILLING_AVAILABLE no core.';
