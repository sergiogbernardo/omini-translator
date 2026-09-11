# Relatório de Validação da Primeira Entrega — Omini Translator

**Data:** 11/09/2026  
**Avaliador:** Antigravity CLI (Verificação e QA Independente)  
**Branch avaliada:** `qa/validation` (cópia de `main` no commit `423d9cf`)  
**Ambiente de execução:** macOS, Node v22.14.0, Google Chrome 153.0 (Headless / DevTools Protocol)

---

## 1. Veredito

**APROVADO COM RESSALVAS** para publicação.

### Justificativa
A aplicação cumpre com alto rigor técnico e robustez as diretrizes centrais estabelecidas no `README.md` e no `TAREFAS.md`:
1. **Segurança de Conteúdo:** Ausência total de `innerHTML`, `outerHTML`, `document.write` ou `eval`. Textos maliciosos (XSS) no texto de entrada ou na resposta do provedor são renderizados estritamente como texto puro via `textContent`.
2. **Credenciais e Privacidade:** Nenhuma chave privada, token ou segredo no código, histórico git ou workflow do GitHub Actions. O uso do MyMemory é estritamente anônimo, sem envio de e-mail ou dados cadastrais. O aviso de privacidade é claro quanto ao tráfego público e à cota anônima diária do provedor (~5.000 caracteres/dia). O histórico local vem desativado por padrão.
3. **Divisão em Blocos UTF-8:** A segmentação em blocos de até 500 bytes UTF-8 foi exaustivamente testada e comprovada. Corta preferencialmente em finais de frases (`.`, `!`, `?`, `。`, etc.), preserva agrupamentos de palavras, mantém separadores e quebras de parágrafo intactos, e trata textos contínuos sem espaços (CJK, URLs longas) por agrupamento de grafemas sem quebra de clusters Unicode.
4. **Tratamento de Concorrência e Respostas Obsoletas:** Edições durante requisições em andamento, troca de idiomas, inversão de idiomas, limpeza ou reabertura do histórico abortam requisições pendentes via `AbortController` e descartam resultados tardios por comparação de ID sequencial. Respostas já exibidas são imediatamente sinalizadas como "Desatualizada" se o texto ou os pares forem modificados.
5. **Workflow de Publicação:** O workflow `.github/workflows/pages.yml` executa a suíte de testes (`npm test`) no Node 22 antes do deploy e empacota exclusivamente os arquivos estáticos necessários para o site público (`index.html`, `styles.css`, `src/*.js`, `.nojekyll`), isolando scripts de teste, relatórios e documentação interna.

A aprovação é dada **com ressalvas** devido a 1 defeito de acessibilidade de severidade média (ausência de rótulo acessível no `textarea` principal de entrada) e 1 inconsistência funcional de severidade baixa (permissão de favoritar pares de idiomas idênticos), descritos na tabela abaixo, que devem ser corrigidos antes do envio para produção.

---

## 2. Tabela de Defeitos

| Severidade | Arquivo:Linha | Descrição do Defeito | Passos para Reproduzir |
| :--- | :--- | :--- | :--- |
| **Média** | `index.html:70` | **Ausência de rótulo acessível no campo de texto principal (`textarea#source-text`).**<br>O `<textarea>` possui apenas `placeholder="Digite ou cole o texto a traduzir…"` e `aria-describedby`, carecendo de um nome acessível válido (`aria-label`, `aria-labelledby="source-title"` ou `<label for="source-text">`). Pelas diretrizes WCAG 2.1 / 2.2 (Critérios de Sucesso 1.3.1 e 4.1.2), o `placeholder` não substitui o rótulo acessível e é sinalizado em leitores de tela e validadores automatizados (axe-core/Lighthouse). | 1. Inspecione `index.html` na linha 70.<br>2. Verifique na árvore de acessibilidade do navegador: o campo não tem nome acessível explicitamente associado ao título da seção ("Texto original"). |
| **Baixa** | `src/app.js:872-888`<br>`src/app.js:834-838` | **Interface permite favoritar par de idiomas idênticos (ex: Inglês → Inglês).**<br>O botão "Favoritar par" (`#favorite-toggle`) permanece ativo quando os idiomas de origem e destino são iguais. Ao clicar, o par inválido (ex.: `en > en`) é gravado em `omini.favorites.v1` e inserido na lista de chips como "Inglês → Inglês". Ao ser clicado pelo usuário, aplica a seleção inválida, acionando o estado de erro "Escolha idiomas de origem e destino diferentes" e desabilitando o botão Traduzir. | 1. Abra o aplicativo e selecione "Inglês" em `De` e "Inglês" em `Para`.<br>2. Clique em "Favoritar par".<br>3. Observe o chip "Inglês → Inglês" criado.<br>4. Clique no chip para aplicar o par e verifique a mensagem de erro. |
| **Baixa** | `src/translation.js:124` | **Decodificação de entidades HTML restrita a 5 entidades nomeadas básicas.**<br>O mapa `named` decodifica apenas `amp`, `apos`, `gt`, `lt`, `quot` e entidades numéricas (`&#...;`). Caso o provedor MyMemory retorne entidades nomeadas como `&nbsp;`, `&eacute;` ou `&ccedil;`, elas são preservadas literalmente no texto em vez de convertidas para caracteres UTF-8. | 1. Simule resposta com `&nbsp;` ou `&eacute;`.<br>2. O texto decodificado mantém `&nbsp;` em vez de converter para espaço não separável. |

---

## 3. Testes Executados e Evidências

Todos os testes foram executados de forma independente neste ambiente.

### 3.1. Testes Unitários Offline (`npm test`)
- **Comando:** `npm test`
- **Ambiente:** Node v22.14.0, runner nativo `node --test`
- **Arquivos:** `tests/translation.test.js` (12 testes originais) + `tests/security_and_robustness.test.js` (12 novos testes criados nesta validação)
- **Resultado:** **24/24 aprovados (100% sucesso, 56 ms)**

#### Detalhamento dos subtestes executados:
1. `splitText preserves content, separators, Unicode, and byte limits` (ok)
2. `splitText packs words into blocks instead of sending one word per request` (ok)
3. `splitText keeps paragraphs apart and cuts long paragraphs at sentence ends` (ok)
4. `splitText splits text without spaces, such as CJK, by grapheme within the limit` (ok)
5. `empty and whitespace-only input do not call the provider` (ok)
6. `same-language input is returned without a request` (ok)
7. `translation is sequential, reports progress, preserves separators, and decodes entities` (ok)
8. `sends only requests within the provider byte limit` (ok)
9. `rejects oversized input and invalid language codes` (ok)
10. `checks HTTP, provider, and empty-result errors` (ok)
11. `reports an exhausted quota as an error with status 429` (ok)
12. `does not skip a failed block and propagates cancellation` (ok)
13. `Security: XSS and script payloads in input are preserved intact without mutation` (ok)
14. `Security: Entity decoding decodes safe XML/HTML entities and numeric code points` (ok)
15. `Security: Malformed or surrogate numeric entities do not throw or produce invalid Unicode` (ok)
16. `Robustness: Exact 500-byte and 501-byte boundaries` (ok)
17. `Robustness: Complex emojis, ZWJ sequences, and multi-byte UTF-8 clusters` (ok)
18. `Robustness: Sentences with trailing quotes, parentheses, and ellipses` (ok)
19. `Robustness: Exact 5,000 Unicode codepoints limit` (ok)
20. `Robustness: Partial failure aborts sequence and does not execute subsequent requests` (ok)
21. `Robustness: Mid-flight cancellation stops immediately without calling next block` (ok)
22. `Robustness: HTTP error statuses (500, 502, 503) propagate status code` (ok)
23. `Robustness: Provider returning invalid JSON rejects gracefully` (ok)
24. `Robustness: Quota detection handles various MyMemory warning formats` (ok)

---

### 3.2. Testes de Interface e Navegador Headless (Chrome DevTools Protocol)
- **Comando:** `python3 -m http.server 8766 --bind 127.0.0.1` + `node tests/browser_e2e.js`
- **Ambiente:** Google Chrome 153.0.8010.36 headless conectado via CDP WebSocket
- **Resultado:** **27/27 verificações aprovadas (0 erros não tratados no console do navegador)**

#### Casos verificados no navegador:
1. **Boot:** Atributo `data-app-ready` definido em `<html>`; banner `#boot-error` oculto (`hidden = true`).
2. **Estado Inicial:** Idiomas padrão `pt` -> `en`; contador "0 / 5.000"; botão "Traduzir" desabilitado; histórico desativado.
3. **Contador e Limite de 5.000 Caracteres:** Digitação atualiza contador dinamicamente; entrada com 5.001 caracteres desabilita botão Traduzir, marca `aria-invalid="true"` e exibe mensagem informativa ("Excede o limite em 1 caractere"), sem truncamento forçado.
4. **Heurística de Detecção:** Selecionar `auto` exibe nota de advertência sobre estimativa local. Digitar frase em inglês ativa estimativa "Inglês (confiança média)".
5. **Inversão de Idiomas:** Botão `#swap` habilita após estimativa bem-sucedida; ao clicar, inverte origem e destino.
6. **Fluxo de Tradução Completo (com mock):** Disparo via clique/Enter exibe barra de progresso, badge "Em andamento", `aria-busy="true"`. Na conclusão: badge "Concluída", texto traduzido renderizado via `textContent`, botão "Copiar" habilitado.
7. **Respostas Obsoletas (Edição do Texto):** Modificar texto após a tradução atualiza badge para "Desatualizada", exibe `#stale-note` e desabilita os botões de cópia e voz.
8. **Botão Limpar:** Limpa entrada original, oculta resultado anterior, restaura badge para "Pronto" e desabilita tradução.
9. **Cancelamento em Andamento:** Clicar em "Cancelar" ou pressionar `Esc` durante tradução demorada aborta a requisição via `AbortController`, exibe aviso "Tradução cancelada por você. Nenhum resultado parcial foi exibido." e ignora resoluções tardias.
10. **Tratamento de Cota Esgotada (429 / MyMemory Warning):** Resposta com cota finalizada exibe card de erro `#error` (`role="alert"`) com título "Limite do provedor atingido", explicação clara sobre cota diária e botão "Tentar novamente".
11. **Segurança XSS (Entrada e Provedor):** Injeção de `<script>window.XSS_TRIGGERED=true;</script><img src=x onerror=...>` no texto de entrada e na resposta simulada do provedor. Nenhuma variável XSS foi executada; as tags foram renderizadas como texto puro.
12. **Armazenamento e Histórico:** Ativação do histórico persiste tradução em `localStorage` sob a chave `omini.history.v1`. Item é listado em `#history-list`. Reabertura do item restaura textos e pares de idiomas. Exclusão em 2 etapas ("Apagar histórico" -> "Confirmar exclusão") esvazia o histórico local.
13. **Acessibilidade:**
    - Skip link funcional apontando para `#source-text`.
    - Confirmação do Defeito 1: `<textarea id="source-text">` não possui rótulo acessível associado.
    - Confirmação do Defeito 2: permissão de favoritar par de idiomas iguais.
14. **Responsividade:**
    - Desktop (1280x800): layout em grade com 2 colunas (`grid-template-columns: 1fr 1fr`).
    - Mobile (390x844): empilhamento em coluna única (`grid-template-columns: 1fr`), sem transbordamento horizontal (`scrollWidth <= innerWidth`).
15. **Console:** Zero erros ou exceções no console do navegador durante toda a sessão.

---

### 3.3. Testes Reais com o Provedor MyMemory
Em estrito cumprimento à regra de no máximo 3 pedidos sintéticos curtos contra o serviço real:
1. **Pedido 1 (curl/node GET direto):**
   - Entrada: `"Hello, world! How are you today?"` (`en|pt`)
   - Resultado: HTTP 200 OK, `responseStatus: 200`, `quotaFinished: false`, tradução: `"Olá, mundo! Como está hoje?"`. Header CORS `access-control-allow-origin: *` confirmado.
2. **Pedido 2 (caracteres especiais e aspas):**
   - Entrada: `"He said: \"Don't worry\" & smiled."` (`en|pt`)
   - Resultado: HTTP 200 OK, tradução: `"Ele disse: \"Não se preocupe\" e sorriu."`. Caracteres acentuados e aspas retornados em UTF-8 direto.
3. **Pedido 3 (via módulo `translateText` com progresso):**
   - Entrada: `"Good morning, world!"` (`en|pt`)
   - Resultado: Tradução `"Bom dia, mundo."` com emissão de eventos de progresso `{ completed: 0, total: 1 }` e `{ completed: 1, total: 1 }`.

Nenhum outro pedido externo foi realizado.

---

## 4. Análise Estática de Código

| Componente / Área | O que foi analisado | Constatações |
| :--- | :--- | :--- |
| **Segurança e XSS** | Busca global de vetores perigosos (`innerHTML`, `outerHTML`, `document.write`, `eval`, `Function`) | **Nenhum vetor perigoso encontrado.** Toda manipulação de dados externos e textos do usuário utiliza `.textContent`, `.append()` e elementos do DOM. |
| **Credenciais e Chaves** | Análise estática do repositório, histórico git (`git log -p`), variáveis e workflow | **Nenhum segredo presente.** O uso do MyMemory é 100% público e sem chaves. Não há segredos nem tokens configurados no repositório. |
| **Armazenamento Local** | Chaves e persistência em `localStorage` | Chaves utilizadas: `omini.prefs.v1`, `omini.favorites.v1` e `omini.history.v1`. O histórico grava apenas se `historyEnabled === true`. Há validação estrutural rígida (`isValidHistoryEntry`) que descarta entradas corrompidas e tratamento com descarte gradual de itens antigos caso o limite de armazenamento do navegador seja excedido (`QuotaExceededError`). |
| **Dependências Externas** | `package.json` e `index.html` | Zero dependências de produção (`dependencies: {}`). Sem scripts de terceiros, sem CDNs, sem fontes remotas ou bibliotecas externas. |
| **Workflow do GitHub Actions** | `.github/workflows/pages.yml` | Roda `npm test` no Node 22 antes do deploy. Copia estritamente os arquivos da aplicação (`index.html`, `styles.css`, `src/*.js`, `.nojekyll`) para `_site`. Não expõe arquivos de teste, relatórios ou markdown de documentação. |
| **Acessibilidade (a11y)** | Elementos de formulário, botões, estados ARIA, foco visível e navegação por teclado | Foco visível definido com outline duplo azul (`:focus-visible`). Atalhos `Ctrl/⌘+Enter` e `Esc` implementados. Regiões `aria-live="polite"` e `role="alert"` para mensagens dinâmicas e erros. Falha encontrada apenas no rótulo do `textarea`. |

---

## 5. Limitações e o que Não Foi Verificado

1. **Leitores de Tela Físicos:** O comportamento do `aria-live` e a audiodescrição foram validados estaticamente e via árvore de acessibilidade do Chromium Headless. Não foram realizados testes práticos com softwares reais como NVDA, JAWS ou VoiceOver.
2. **Reprodução Física de Áudio:** A API `window.speechSynthesis` foi inspecionada quanto a parâmetros e manipulação de eventos, mas a emissão sonora física em alto-falante não foi aferida (ambiente headless/servidor).
3. **Navegadores Safari (WebKit) e Firefox (Gecko):** Os testes automatizados de ponta a ponta foram executados no motor Chromium (v153). Testes visuais e de comportamento em Safari e Firefox reais não foram executados neste ciclo.
4. **Execução Remota no GitHub Actions:** Não foram efetuados push, abertura de pull requests ou acionamento de workflows remotos no repositório do GitHub, conforme as regras de isolamento estabelecidas. A verificação do workflow foi realizada por auditoria estática do arquivo YAML e execução local idêntica das etapas (`npm test` e preparação do diretório `_site`).

---

## 6. Recomendações para a Próxima Etapa

1. **Correção do Rótulo do Textarea (Defeito 1):** Adicionar `aria-labelledby="source-title"` ou `<label class="sr-only" for="source-text">Texto original a traduzir</label>` em `index.html`.
2. **Validação do Par Favorito (Defeito 2):** Em `src/app.js`, desabilitar o botão `#favorite-toggle` ou ignorar a ação quando `sourceSel === target`.
3. **Decodificação de Entidades Adicionais (Defeito 3):** Expandir `decodeEntities` em `src/translation.js` para cobrir entidades comuns adicionais (`nbsp`, `eacute`, etc.) ou utilizar decodificador baseado no DOM caso compatível com ambientes offline.
4. **Atualização do README:** Atualizar a tabela de "Escolhas pendentes" no `README.md` para refletir as decisões já implementadas no código (8 favoritos, 12 itens de histórico desativados por padrão).
