---
id: 0014
titulo: Pins de contrato mudam só por decisão própria
status: aceita
data: 2026-08-27
origem: superpowers/specs/2026-08-08-wp-narration-plugin-mvp-design.md
enforced_by: [ contract-pins ]
revisar_quando: o WordPress 6.6 sair do suporte, ou o mirror do modelo mudar de host
desvios: []
---

## Contexto

Três valores se comportam como contrato: o SHA de commit em `MODEL_BASE_URL`,
o mínimo de WordPress e o mínimo de PHP. Cada um está declarado em vários
arquivos — o mínimo de plataforma sozinho aparece em cinco — e nada garantia
que concordassem entre si. Mover qualquer um deles como efeito colateral de
um trabalho não relacionado quebra usuários em silêncio: um mínimo que sobe
num arquivo e fica para trás nos outros, ou um modelo que passa a apontar
para uma ref que muda debaixo do autor.

## Decisão

Os pins só mudam por decisão própria, com o seu próprio teste — nunca como
efeito colateral de outro PR. `MODEL_BASE_URL` aponta para um commit fixado
no mirror próprio do plugin, nunca para `resolve/main` nem para o repositório
upstream. Os mínimos de plataforma têm de concordar entre `post-voice.php`,
`readme.txt`, `composer.json`, `phpcs.xml.dist` e `.wp-env.json` — os cinco
lugares onde WordPress e Composer, cada um, leem o seu próprio valor.

## Consequências

Fica mais fácil: o modelo baixado hoje é o mesmo de seis meses atrás, e o
mínimo declarado é um só, não cinco que podem divergir. Fica mais difícil:
subir qualquer um dos mínimos vira um PR próprio, com smoke test dos cinco
idiomas suportados e a suíte E2E — não é mais uma linha trocada de passagem.

## Como verificar

`contract-pins` confere a **concordância** entre os cinco arquivos de mínimo
de plataforma, e que o segmento após `resolve/` em `MODEL_BASE_URL` é um SHA
de 40 hexadígitos, não uma ref simbólica como `main`. A regra deliberadamente
**não** fixa os valores em si — nem os mínimos atuais, nem o SHA atual:
fixá-los faria toda subida de mínimo ou toda atualização de modelo exigir
editar a própria ADR, quando o que importa é que os arquivos não divirjam
entre si.

## Alternativas rejeitadas

**Apontar `MODEL_BASE_URL` para `resolve/main`.** O modelo muda debaixo dos
usuários sem nenhum PR que registre a mudança.

**Um único arquivo como fonte da verdade, com os outros quatro gerados.**
WordPress e Composer leem os seus próprios formatos nativamente; centralizar
exigiria um passo de geração de código só para isto.
