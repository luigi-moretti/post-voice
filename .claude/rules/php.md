---
paths:
  - "features/*/php/**/*.php"
  - "shared/php/**/*.php"
  - "post-voice.php"
---

# PHP

- Uma feature não referencia classe de outra feature; `shared/` é a fronteira, e só a partir do segundo consumidor real (ADR-0004, ADR-0005). **A ADR-0005 está `aceita-com-desvio`**: onze arestas existentes estão congeladas em `desvios:` e não devem ser "consertadas" de passagem — corrigir uma é decisão própria, com o seu PR. `npm run lint:arch` distingue as congeladas das novas; confie nele, não na sua leitura do código.
- O servidor não sintetiza fala, não transcodifica áudio e não recomputa hash de conteúdo nem seleção de blocos — tudo isso é do cliente (ADR-0002, ADR-0008, ADR-0009).
- Toda string visível ao usuário passa por gettext com o domínio `post-voice`; regenere o `.pot` com `npm run i18n:pot` quando strings mudarem (ADR-0010).
