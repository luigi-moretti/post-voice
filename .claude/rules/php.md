---
paths:
  - "features/**/php/**/*.php"
  - "shared/php/**/*.php"
  - "post-voice.php"
---

# PHP

- Prefixo `Post_Voice_`, uma classe por arquivo, `class-<algo>.php` derivado do nome da classe, carregada por `require_once` em `post-voice.php` (ADR-0006).
- Uma feature nunca referencia classe de outra feature; `shared/` é a fronteira, e só a partir do segundo consumidor real (ADR-0004, ADR-0005).
- O servidor não sintetiza fala, não transcodifica áudio e não recomputa hash de conteúdo nem seleção de blocos — tudo isso é do cliente (ADR-0002, ADR-0008, ADR-0009).
- Toda string visível ao usuário passa por gettext com o domínio `post-voice`; regenere o `.pot` com `npm run i18n:pot` quando strings mudarem (ADR-0010).
- Classe de teste PHPUnit declara `@covers` (ADR-0013).
