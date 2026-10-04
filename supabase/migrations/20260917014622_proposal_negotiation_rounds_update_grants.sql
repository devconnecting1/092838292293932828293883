-- =============================================================================
-- Rodadas da negociação: quem edita a proposta registra sinal, financiamento,
-- permuta, prazo e o tipo da rodada
-- =============================================================================
-- proposals usa UPDATE por coluna para authenticated. As colunas novas da
-- rodada vigente (migração proposal_negotiation_rounds) entram na lista.
-- round_number continua fora: quem numera a rodada é o gatilho
-- proposals_negotiation_round.
grant update (round_kind, down_payment, financing_amount, exchange_description, payment_deadline)
  on public.proposals to authenticated;
