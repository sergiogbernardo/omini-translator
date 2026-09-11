# Primeira entrega — proposta de execução

Estado: tarefas preparadas, ainda não enviadas às CLIs. O README é a referência de decisões; este arquivo delimita a execução após o fechamento do briefing.

## Escopo proposto

- HTML, CSS e JavaScript nativos, sem dependências de produção.
- Entrada e resultado lado a lado no desktop e empilhados no celular; fundo branco, azul nas ações, sem animação Matrix.
- Tradução por botão; máximo proposto de 5.000 pontos de código Unicode por operação, com contador. Isso não garante cota disponível no provedor.
- Preservar os dez idiomas, troca, cópia e leitura em voz alta. Histórico opcional e local; detecção heurística explicitamente indicada como estimativa, com seleção manual sempre disponível.
- MyMemory sem chave, e-mail ou backend; chamadas sequenciais com progresso e cancelamento.

## Ordem e responsabilidades

1. **Codex CLI — preparação:** criar Git local e estrutura, verificar o remoto informado sem sobrescrever conteúdo e definir contrato dos módulos. Não publicar antes da validação. Entregar scripts de teste e workflow Pages usando somente os arquivos do site.
2. **Claude CLI — interface:** implementar `index.html`, `styles.css` e `src/app.js`, usando o contrato de tradução. Estados separados de pronto, progresso, cancelado, erro e concluído. Textos externos devem ser renderizados com `textContent`. Não alterar o módulo do Copilot.
3. **Copilot CLI — tradução:** implementar `src/translation.js` e `tests/translation.test.js`. Segmentos limitados a 500 bytes UTF-8; nenhum caractere perdido ou duplicado; preservar separadores de parágrafos. Validar HTTP, status da API e resposta vazia; interromper em falha ou cancelamento. Não modificar a interface.
4. **Codex CLI — integração:** reunir branches, executar testes e corrigir incompatibilidades com os autores. Criar preview local antes da entrega.
5. **Antigravity CLI — verificação:** testar a versão integrada, registrar evidências funcionais e verificar tratamento de HTML malicioso, credenciais, armazenamento, respostas obsoletas, falhas parciais e cota. Testes do provedor devem usar apenas textos sintéticos curtos; testes grandes usam mocks. Não executar varreduras contra o serviço externo.
6. **Codex CLI — entrega:** após validação, configurar o fluxo de publicação autorizado e conferir o site entregue. Registrar qualquer bloqueio de autenticação ou permissões sem contorná-lo.

## Contrato proposto para tradução

`translateText(text, { source, target, signal, onProgress })` retorna `Promise<string>` com a tradução completa. Progresso: `{ completed, total }`. Uma falha rejeita a operação, sem apresentar o resultado parcial como completo. `source` deve ser um código explícito de idioma suportado; a interface resolve a opção de detecção antes de chamar o módulo.

`splitText(text, maxBytes = 500)` retorna uma sequência de partes `{ text, translate }`, distinguindo trechos traduzíveis de separadores preservados. A concatenação de `text` deve ser idêntica à entrada; cada parte traduzível respeita o limite UTF-8. O contrato deve ser estabilizado antes do desenvolvimento paralelo.

## Verificação mínima

- Entrada vazia, 500 e 501 bytes, acentos, emoji, texto sem espaços, parágrafos e quebras de linha.
- Cancelamento durante a rede; troca de idioma ou edição enquanto uma resposta está pendente.
- HTTP com erro, erro informado no JSON, timeout, cota esgotada e falha no meio dos blocos.
- Teclado, celular e texto semelhante a HTML exibido sem execução.
- Não declarar integração real ou auditoria concluída sem executá-la. Cada IA registra os testes efetivamente realizados.
