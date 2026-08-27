# Registros de decisão de arquitetura

O que está decidido, por quê, e o que impede de ser desfeito por acidente.

- **Não decide nada aqui.** Uma ADR registra uma decisão já tomada.
- **A ADR é a configuração do linter.** `npm run lint:arch` lê o `enforced_by` e
  o `desvios:` do front-matter destes arquivos. Editar `desvios:` muda o que o
  CI aceita — é a única parte do texto que qualquer PR pode mexer.
- **`status: aceita-com-desvio`** significa que a decisão vale e que as violações
  já existentes estão congeladas e listadas. Aresta nova reprova.
- **Quer criar uma?** Leia a ADR-0001: ela contém o critério de admissão e o
  que fazer quando a resposta é "não". Copie `TEMPLATE.md`.

| # | Título | Status | Defendida por |
|---|---|---|---|
| [0001](0001-registrar-decisoes-em-adr.md) | Registrar decisões de arquitetura como ADR | aceita | `doctor` |
