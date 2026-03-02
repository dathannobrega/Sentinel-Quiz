# Frontend Acceptance Checklist

## UX

- [ ] A tela inicial em `web/app/page.tsx` cobre loading, error parcial, empty e success.
- [ ] O usuario consegue entrar, criar conta, sair e iniciar sessao sem recarregar a pagina.
- [ ] O runner em `web/app/exam/[sessionId]` e `web/app/study/[sessionId]` permite responder e avancar sem recarregar a pagina.
- [ ] O study runner permite editar bookmark e nota da questao sem sair do fluxo.
- [ ] O resultado em `web/app/*/[sessionId]/result` mostra revisao basica, justificativa e referencias.
- [ ] A tela `web/app/history` cobre filtros, fila de revisao, historico e analytics semanais.
- [ ] A tela `web/app/admin` cobre overview, busca, CRUD de prova/questao, reimportacao e exportacao.
- [ ] CTAs sao curtos e consistentes.
- [ ] O fluxo deixa claro quando a sessao foi criada e qual e o proximo passo.

## Acessibilidade

- [ ] Labels conectados a inputs.
- [ ] Foco visivel em elementos interativos.
- [ ] Mensagens de erro/sucesso com `role` apropriado.
- [ ] Layout continua navegavel por teclado.

## Engenharia

- [ ] O contrato HTTP esta centralizado em `web/lib/api/client.ts`.
- [ ] O estado de auth e device key usa chaves compatveis com o legado.
- [ ] Componentes base sao reutilizaveis e com props tipadas.
- [ ] O CSS usa tokens e nao replica estilos aleatorios por tela.

## Performance

- [ ] O dashboard carrega requests em paralelo.
- [ ] Falha parcial de endpoint nao derruba toda a tela.
- [ ] Nao existe manipulacao imperativa de DOM no novo frontend.

## Integracao

- [ ] `NEXT_PUBLIC_API_ORIGIN` permite apontar para backend remoto sem mudar codigo.
- [ ] A criacao de sessao persiste o `sessionId` nas mesmas chaves do frontend legado.
- [ ] As imagens `api` e `web` sobem juntas em `docker compose`.
- [ ] O backend nao depende mais de arquivos estaticos do frontend legado para iniciar.
