# Notas exploratórias — customização do player (Fase 3)

**Data:** 2026-08-09
**Status:** Pré-trabalho, não é spec aprovado. Fase 3 ainda não foi priorizada nem tem plano de implementação. Isso só registra decisões de UI/UX exploradas adiantado enquanto a Fase 1 estava em revisão, pra não perder o raciocínio.
**Não altera** [`2026-08-08-wp-narration-plugin-mvp-design.md`](2026-08-08-wp-narration-plugin-mvp-design.md) (Fase 1) — aquele doc segue sendo a fonte de verdade do que está aprovado pra implementar agora.

## Onde a tela mora

Página própria em `Configurações → Narração` (`add_options_page`), não Customizer/Site Editor Global Styles. Motivo: Global Styles é por `theme.json`, amarra a implementação ao suporte do tema ativo a blocos customizados — complexidade grande pra "escolher 2-3 cores do player". Página de Configurações simples é o padrão da maioria dos plugins pra isso, sem dependência de tema.

## Layout — opção B aprovada (exploratória)

Preview ao vivo do player no topo da página; campos de customização em tabela clássica de settings page do WP (`do_settings_sections`) abaixo. Comparada com opção A (split lado a lado) — B ganhou.

Preview ao vivo é **não-negociável** nas duas opções: sem isso, ajustar cor vira tentativa-e-erro (mudar → salvar → abrir o post → ver → voltar → repetir).

Campos considerados no mockup (ponto de partida, não fechado): cor de destaque (botão play + barra de progresso), cor de fundo do player, borda arredondada. Botão salvar + link "restaurar padrão".

Mockups (fonte + screenshot):
- [`assets/2026-08-09-player-settings-options.html`](assets/2026-08-09-player-settings-options.html) — comparação A vs B.
- [`assets/2026-08-09-player-settings-option-b.png`](assets/2026-08-09-player-settings-option-b.png) — screenshot renderizado.

## Em aberto pra quando a Fase 3 for de fato speced

- Lista final de campos de customização (só cor, ou também tipografia/posição do player sticky?) — mockup fixou em cor+borda como ponto de partida, não é exaustivo.
- Como o preview ao vivo é implementado (reusar o mesmo componente TS do player real do frontend, renderizado dentro do admin, não recriar do zero) — decisão de arquitetura pra quando chegar a vez.
- Onde por padrão as cores herdam de quê (tema ativo? cor de destaque do WP admin? fixo?) antes do autor customizar.
