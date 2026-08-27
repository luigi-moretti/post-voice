---
id: 0006
titulo: Nomenclatura e carregamento de classe PHP sem autoloader
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md#arquitetura
enforced_by: [ php-class-naming ]
revisar_quando: o plugin adotar autoload PSR-4 via Composer
desvios: []
---

## Contexto

WordPress não tem namespaces por convenção: todo plugin ativo compartilha o
mesmo espaço de nomes global de classes e funções, e uma colisão de nome
quebra o site sem aviso em tempo de escrita. O plugin tem hoje 10 classes PHP,
todas carregadas por `require_once` explícito em `post-voice.php` — não há
autoloader nem mapa de classe para arquivo além da convenção do nome.

## Decisão

Toda classe se chama `Post_Voice_<Algo>`, mora sozinha num arquivo
`class-<algo>.php` cujo nome é derivado da classe, e é carregada por um
`require_once` em `post-voice.php`. Um arquivo, uma classe, um `require_once`.

## Consequências

Fica mais fácil: do nome da classe chega-se ao arquivo sem consultar índice
algum, e o prefixo elimina colisão com qualquer outro plugin ou com o core.
Fica mais difícil: renomear uma classe é renomear o arquivo e ajustar a linha
correspondente em `post-voice.php` à mão; adotar PSR-4 mais tarde não é um
ajuste, é uma migração das 10 classes de uma vez.

## Como verificar

`php-class-naming` — toda classe declarada em `features/**/php/` ou
`shared/php/` casa com `Post_Voice_[A-Z][A-Za-z_]*`, vive num arquivo cujo
nome é o slug da classe prefixado por `class-`, e tem um `require_once`
correspondente em `post-voice.php`.

## Alternativas rejeitadas

**Namespaces PHP.** Nem o WPCS nem o ecossistema de plugins WordPress os
adotam por convenção, e o ganho para 10 classes num único plugin é pequeno
frente ao custo de sair do padrão que qualquer contribuidor de plugin já
reconhece.

**Autoloader Composer (PSR-4).** Adiciona uma dependência de runtime — o
`vendor/autoload.php` — só para resolver 10 arquivos que um `require_once`
explícito já resolve sem indireção nem custo de I/O extra por request.
