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
| [0002](0002-tts-roda-no-navegador.md) | O TTS roda inteiro no navegador; o servidor só orquestra | aceita | `no-server-side-tts` |
| [0003](0003-engine-pocket-tts.md) | Pocket TTS como engine, não Piper | aceita | `review-manual` |
| [0004](0004-layout-por-feature.md) | Layout por feature; `shared/` só a partir do segundo consumidor | aceita-com-desvio | `feature-layout`, `shared-two-consumers` |
| [0005](0005-topologia-de-dependencia-entre-features.md) | Topologia de dependência entre features | aceita-com-desvio | `feature-deps` |
| [0006](0006-nomenclatura-de-classe-php.md) | Nomenclatura e carregamento de classe PHP sem autoloader | aceita | `php-class-naming` |
| [0007](0007-rest-namespace-e-validacao-no-servidor.md) | Namespace REST fixo e validação sempre no servidor | aceita | `rest-namespace`, `review-manual` |
| [0008](0008-source-hash-e-calculado-no-cliente.md) | O `source_hash` é calculado no cliente; o PHP só guarda e compara | aceita | `no-narration-logic-in-php` |
| [0009](0009-audio-comprimido-no-cliente.md) | O áudio é comprimido no cliente; o servidor nunca transcodifica | aceita | `no-server-side-audio-processing` |
| [0010](0010-i18n-desde-o-primeiro-commit.md) | i18n desde o primeiro commit, com o domínio `post-voice` | aceita | `i18n-text-domain`, `review-manual` |
| [0011](0011-editor-em-typescript.md) | O editor é TypeScript | aceita-com-desvio | `no-untyped-editor-code` |
| [0012](0012-fronteira-jest-e2e.md) | Fronteira entre Jest e E2E — Worker e ONNX não se mockam | aceita | `review-manual`, `doctor` |
| [0013](0013-covers-por-classe-e-gates-de-cobertura.md) | `@covers` por classe, e gates de cobertura que não descem | aceita | `covers-annotation` |
| [0014](0014-pins-de-contrato.md) | Pins de contrato mudam só por decisão própria | aceita | `contract-pins` |
| [0015](0015-npm-ci-nunca-npm-install.md) | `npm ci` em CI e scripts; `npm install` nunca | aceita | `no-npm-install` |
