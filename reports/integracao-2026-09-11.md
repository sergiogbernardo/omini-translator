# Integração da primeira entrega — 11/09/2026

Integração feita pelo Claude CLI (sessão interativa), continuando o trabalho do Codex, que falhou ao iniciar (`Operation not permitted` ao abrir o estado em `~/.codex`).

## O que foi integrado

| Branch | Autor | Conteúdo |
| --- | --- | --- |
| `feat/translation` | Copilot CLI | `src/translation.js`, `tests/translation.test.js` |
| `feat/interface` | Claude CLI (headless, despachado pelo Codex) | `index.html`, `styles.css`, `src/app.js` |
| `main` (integração) | Claude CLI | `package.json`, `.github/workflows/pages.yml`, correções abaixo |

Os worktrees em `.orchestration/` estavam em branches sem nenhum commit (não descendiam de `main`); foram reapontados para `main` antes dos commits, sem alterar arquivos.

## Correções feitas na integração

1. **Segmentação palavra a palavra (grave).** `splitText` enviava cada palavra num pedido separado: um texto de 5.000 caracteres geraria centenas de pedidos e tradução sem contexto. Agora os parágrafos são preservados como separadores e as palavras são agrupadas em blocos de até 500 bytes UTF-8, cortando preferencialmente no fim de frases. Texto sem espaços (CJK, URLs longas) continua dividido por grafema. Testes que codificavam o comportamento antigo foram ajustados; foram adicionados testes de agrupamento, parágrafos e CJK.
2. **Cota esgotada.** O MyMemory pode sinalizar cota com `quotaFinished: true` ou com o aviso "MYMEMORY WARNING" no lugar da tradução; antes isso seria exibido como tradução. Agora rejeita com `status: 429`, e os erros do provedor levam `status`, que a interface já interpreta.
3. Script `npm test` usa glob (`node --test` do Node 22 não aceita diretório).

## Testes executados

- `npm test`: **12/12** (Node 22.14, mocks de `fetch`, sem rede).
- Navegador: Chrome headless via DevTools Protocol, servidor local. **15/15**, sem erros de console:
  - arranque; texto longo com acentos, emoji e parágrafos (blocos ≤ 500 bytes, poucos pedidos, nada perdido, ordem e parágrafos preservados);
  - edição durante pedido pendente (resposta antiga descartada); cancelamento;
  - cota esgotada exibida como erro; HTTP 503 com nova tentativa; falha no meio dos blocos sem resultado parcial;
  - HTML no texto e na resposta exibido como texto, sem execução;
  - limite de 5.000 excedido e entrada vazia (botão desativado, sem pedido);
  - detecção rotulada como estimativa; histórico desativado por padrão e salvo localmente quando ativado;
  - **1 pedido real** ao MyMemory com texto sintético curto ("Good morning, team." → "Bom dia, equipa.");
  - celular 390 px sem rolagem horizontal.
- Capturas de tela conferidas em desktop (1280 px) e celular (390 px).

## Não executado / pendente

- Validação independente do Antigravity (segurança, teclado completo, leitores de ecrã, Safari/Firefox).
- Leitura em voz alta e cópia não foram verificadas manualmente (headless).
- Workflow do Pages não executado: nada foi enviado ao GitHub. O remoto `sergiogbernardo/omini-translator` não foi verificado nem sincronizado.
- Decisões ainda abertas no README (favoritos entraram na interface; histórico com 12 entradas, desativado por padrão).

## Após a validação do Antigravity

Veredito do Antigravity: aprovado com ressalvas, nenhum defeito de severidade alta (ver `reports/validacao-antigravity-2026-09-11.md`). Os três defeitos apontados foram confirmados e corrigidos:

- Média: `textarea` sem rótulo acessível → `aria-labelledby="source-title"`.
- Baixa: favoritar par com origem igual ao destino → bloqueado, e pares assim são ignorados ao carregar.
- Baixa: entidades nomeadas além das 5 básicas ficavam literais → mapeadas as mais comuns (`&nbsp;`, aspas tipográficas, travessões, `&hellip;` etc.).

Depois das correções: `npm test` 25/25 e verificação no navegador 15/15, sem erros de console.
