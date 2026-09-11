# Omini Translator

Evolução do TranslatorVG: tradutor de textos com visual executivo, minimalista, branco e azul, e suporte a textos maiores.

**Estado:** primeira entrega integrada localmente em `main` (11/09/2026), ainda não publicada nem validada pelo Antigravity. Ver `reports/integracao-2026-09-11.md`. Propostas e pendências abaixo continuam não aprovadas.

Executar localmente: `npm start` (servidor em http://localhost:8080) e `npm test` (testes offline do módulo de tradução). A página usa módulos ES e não funciona aberta diretamente do disco.

## Decisões confirmadas

- Nome do produto: **Omini Translator**; evolução conceitual TranslatorVG 2.0.
- Novo projeto independente em `Github/omini-translator`, preservando `Github/Translatorvg`.
- Repositório indicado: https://github.com/sergiogbernardo/omini-translator (destino informado pelo proprietário; sincronização ainda não realizada).
- Interface moderna, minimalista e profissional, com branco e azul predominantes.
- Manter a proposta de tradução de texto da versão inicial e aumentar a capacidade de entrada utilizável.
- Publicação da interface pelo GitHub Pages, com entrega via GitHub Actions.
- Definições de produto discutidas com Sergio antes da implementação.
- Provedor escolhido: **MyMemory público, sem cadastro, sem chave e sem envio de e-mail**.
- Arquitetura escolhida: **site estático no GitHub Pages, sem backend adicional**.
- Textos maiores serão divididos em blocos de no máximo **500 bytes UTF-8**, mantendo ordem e parágrafos, com progresso e cancelamento.
- A divisão não elimina a cota documentada de **5.000 caracteres/dia no uso anônimo**; o produto não prometerá uso ilimitado.
- Azure, DeepL e serviços que exijam nova conta não serão adotados nesta versão.

## Análise do TranslatorVG

Análise estática em 11/09/2026 da cópia local `../Translatorvg`, HEAD `64d05f8`. Arquivos examinados: `README.md`, `index.html`, `app.js`, `styles.css` e `.github/workflows/deploy.yml`. Não foram realizados testes de tradução reais nem auditoria de segurança nesta etapa. Havia alteração local em `.gitignore`; o original não foi modificado.

| Área | Situação encontrada |
| --- | --- |
| Tecnologia | HTML, CSS e JavaScript nativos; sem build ou backend próprio nos arquivos examinados. |
| Tradução | Chamada GET direta do navegador a `api.mymemory.translated.net/get`, enviando todo o texto no parâmetro `q`. |
| Entrada | `textarea` sem `maxlength`; sem contador, divisão em blocos ou controle do tamanho em bytes. |
| Idiomas | Dez idiomas selecionáveis, além da opção de detecção automática na origem. |
| Detecção | Heurística local por palavras e caracteres; retorna inglês como fallback. Não é detecção fornecida pela API. |
| Recursos | Troca de idiomas, cópia, leitura em voz alta, cinco entradas de histórico e cinco pares favoritos. |
| Armazenamento | Histórico e preferências em `localStorage`; cache de traduções em memória. |
| Disparo | Tradução automática após 500 ms sem digitação, além do botão Traduzir. |
| Aparência | Fundo escuro, verde e animação Matrix; será redesenhada. |
| Publicação | Workflow copia os arquivos estáticos e publica no Pages ao receber push em `main` ou execução manual. |

### Limite real e problemas a resolver

O MyMemory documenta **500 bytes UTF-8 por requisição**. Bytes não equivalem a caracteres: acentos, emojis e outros alfabetos podem ocupar mais de um byte. O código atual não respeita esse limite por segmentação. A documentação também informa cotas de **5.000 caracteres/dia no uso anônimo** e **50.000 com o parâmetro de e-mail válido**. Dividir o texto não elimina essas cotas.

Fontes consultadas em 11/09/2026: [especificação MyMemory](https://mymemory.translated.net/doc/spec.php) e [limites de uso](https://mymemory.translated.net/doc/usagelimits.php). Não foi configurado envio de e-mail nem contratado serviço.

Outros pontos observados no código:

- Requisições anteriores não são canceladas ao mudar ou limpar o texto; uma resposta atrasada pode sobrescrever o resultado atual.
- O status mostra “MyMemory online” sem verificar disponibilidade e volta a esse estado mesmo após falha.
- A resposta é verificada pelo status HTTP, mas não há validação explícita de `responseStatus` da API.
- O título do resultado pode indicar conclusão mesmo quando o conteúdo é uma mensagem de erro.
- Traduções vindas da rede são gravadas no histórico mesmo quando `saveHistory` é falso.
- O texto é enviado ao serviço externo e pode ficar persistido no navegador. A experiência deve explicar esse comportamento; aparência executiva não implica confidencialidade empresarial.

## Proposta técnica — ainda sujeita à escolha

- Preservar uma interface estática compatível com Pages e separar interface, provedor de tradução, armazenamento e tratamento de textos longos em módulos.
- Implementar o MyMemory escolhido com segmentação UTF-8 e preservação da ordem e dos parágrafos; propor chamadas sequenciais e tratamento de cotas e falhas parciais.
- Para textos longos, oferecer tradução explícita por botão, progresso e cancelamento, evitando requisições a cada pausa de digitação.
- Exibir erros como erros, descartar respostas obsoletas e permitir nova tentativa sem perder a entrada.
- Renderizar texto do usuário e do provedor como texto, sem interpretar HTML.
- Nunca colocar credenciais privadas em JavaScript público ou no artefato do Pages. Se o provedor exigir segredo, avaliar um backend separado; Actions será usado para entrega, não como serviço de tradução a cada pedido.

## Escolhas pendentes

| Decisão | O que precisamos definir |
| --- | --- |
| Provedor | Resolvido: MyMemory público, sem nova conta e sem backend. |
| Capacidade | Meta de caracteres por tradução e volume diário. Nenhum número novo está aprovado. |
| Tradução automática | Manter para textos curtos, tornar opcional ou usar apenas o botão. |
| Recursos herdados | Confirmar idiomas, detecção, histórico, favoritos e leitura em voz alta no primeiro lançamento. |
| Privacidade | Se o histórico será habilitado por padrão e como o usuário será informado sobre envio e armazenamento. |
| Design | Aprovar composição da tela, tom de azul, tipografia e comportamento no celular. |
| Implementação | Confirmar JavaScript nativo ou necessidade de framework após fechar o escopo. |

## Responsabilidades das IAs

| Responsável | Escopo |
| --- | --- |
| Sergio + coordenação nesta conversa | Decisões de produto, briefing e encaminhamento das tarefas. |
| Codex CLI | Git, branches, integração, GitHub, Actions e Pages. |
| Claude CLI | Desenvolvimento principal da interface e do fluxo de tradução. |
| Copilot CLI | Apoio ao desenvolvimento com módulos independentes e testes; divisão exata de arquivos antes de cada tarefa. |
| Antigravity CLI | Testes funcionais, verificações de segurança e aderência ao briefing, com evidências e limitações registradas. |

### Como o trabalho será coordenado

1. Fechar as escolhas pendentes neste README.
2. Distribuir tarefas com entradas, arquivos permitidos, dependências e critérios de conclusão.
3. Usar branches e worktrees separados para desenvolvimento paralelo. Evitar edições simultâneas no mesmo arquivo.
4. Cada IA entregar resumo, arquivos alterados, testes executados e impedimentos. Não declarar teste não executado como aprovado.
5. Codex integrar; Antigravity validar a versão integrada; encaminhar correções ao responsável.
6. Publicar após a validação e conferir o site entregue.

As quatro CLIs não se coordenam automaticamente pela grade de terminais. O despacho e o acompanhamento precisam ser explícitos. Nesta etapa, somente este documento foi preparado; nenhuma tarefa de implementação foi enviada às CLIs.

## Critérios propostos para o primeiro lançamento

- Visual branco e azul aprovado, utilizável em desktop e celular e navegável por teclado.
- Texto dentro do limite escolhido traduzido sem truncamento silencioso, preservando a ordem dos segmentos.
- Testes com acentos, emojis, parágrafos, entrada vazia, limite excedido, falha de rede e cota esgotada.
- Cancelar ou editar a entrada não permite que uma resposta antiga substitua a atual.
- Nenhuma chave privada no repositório, logs de CI ou site público.
- Verificação de conteúdo HTML malicioso, armazenamento local e dependências na versão implementada.
- Workflow validado e recursos carregando corretamente no caminho do projeto no Pages.

## Próximo passo

Validar a proposta de primeira entrega em `TAREFAS.md`: entrada de até 5.000 caracteres Unicode por operação, tradução por botão e manutenção dos recursos básicos. Esse limite de interface ainda é uma proposta; não representa saldo diário garantido. Após fechar o briefing, despachar as tarefas às quatro CLIs.

### Registro de decisão — 11/09/2026

Após comparar alternativas, Sergio optou por não criar outra conta e confirmou seguir com MyMemory. As cotas são impostas pelo provedor; um contador local não conhece consumo em outros dispositivos ou aplicações e não deve ser apresentado como saldo oficial.
