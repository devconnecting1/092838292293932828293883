# Formato de dados para parceiros (Vamos Arrematar)

O parceiro entrega a lista de imóveis em **JSON** (lista de objetos) ou **CSV** (separador `;`, primeira linha com os nomes dos campos), por um link fixo ou por envio direto à função `importar-feed`.

A cada envio completo, o que não vier mais na lista sai do portal. O que entrar novo aparece. Mudança de preço fica no histórico.

## Campos

| Campo | Obrigatório | Exemplo | Observação |
|---|---|---|---|
| codigo | sim | 2432519 | código do imóvel no site do parceiro |
| uf | sim | RJ | |
| cidade | sim | Nova Iguaçu | |
| preco | sim | 76967,53 | lance mínimo ou valor de venda atual |
| origem | sim | Itaú Unibanco | banco, tribunal ou "extrajudicial" |
| codigo_banco | recomendado | 8787710575312 | número do imóvel no banco (evita duplicar) |
| codigo_leilao | recomendado | Lote 12 / Edital 0045-2026 | |
| leiloeiro | recomendado | Nome do leiloeiro oficial | |
| leiloeiro_registro | recomendado | JUCERJA 000 | matrícula na Junta Comercial |
| intermediador | quando houver | Imobiliária X, CRECI 0000 | venda direta sem leiloeiro |
| avaliacao | recomendado | 145000,00 | |
| data_leilao_1 / data_leilao_2 | quando houver | 05/10/2026 14:00 | |
| lance_leilao_2 | quando houver | 60000,00 | |
| data_encerramento | quando houver | 05/10/2026 18:00 | venda online |
| modalidade | recomendado | Leilão judicial, Venda direta online | |
| edital | recomendado | https://... | link do edital |
| link | recomendado | https://... | página do imóvel no parceiro |
| fotos | opcional | https://...jpg\|https://...jpg | separadas por \| |
| bairro, endereco, cep, tipo, descricao | opcional | | |
| area_total, area_privativa, area_terreno, quartos, vagas | opcional | | |
| matricula, cartorio, processo, vara | opcional | | judicial: número do processo e vara |
| financiamento | opcional | sim / não | |
| latitude, longitude | opcional | | |

Datas no formato `dd/mm/aaaa hh:mm` (horário de Brasília) ou ISO 8601. Valores com vírgula decimal ou ponto.

## Como enviar

- **Link fixo**: o parceiro informa uma URL que devolve o arquivo completo. O portal busca no intervalo combinado.
- **Envio direto**: `POST https://pgkrhbyvinhffobniktg.supabase.co/functions/v1/importar-feed` com o cabeçalho `x-import-token` (fornecido em privado) e o corpo `{"fonte":"leilaoimovel","completo":true,"itens":[...]}` ou `{"fonte":"leilaoimovel","completo":true,"csv":"..."}`.
