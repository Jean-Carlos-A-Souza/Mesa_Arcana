# Daeva - Auto Meditar

Bot em Playwright que roda no **GitHub Actions** e executa sozinho o caminho completo do Daeva até a meditação. Ele não depende do seu computador estar ligado.

## Fluxo atual

1. Abre `https://site-fichas-daeva1.vercel.app/login`.
2. Preenche o **e-mail** e a **senha de login**.
3. Entra na página **Fichas de Personagem**.
4. Procura a ficha **Han Zhen** e clica nela.
5. Se a abertura pelo cartão falhar, usa a URL exata da ficha como fallback.
6. Detecta a tela **Ficha Protegida**.
7. Preenche a **senha da ficha** e clica em **Revelar Ficha**.
8. Procura o botão **+1 QI / Meditar**.
9. Só clica se o elemento estiver visível e habilitado.
10. Depois do clique, tenta confirmar a requisição e a mudança de estado da interface.

O workflow executa automaticamente a cada **15 minutos** e também pode ser iniciado manualmente pela aba **Actions**.

## O que você precisa preencher

Abra `config.json` e altere somente estes três valores:

```json
"email": "SEU_EMAIL",
"senhaLogin": "SUA_SENHA_DE_LOGIN",
"senhaFicha": "SUA_SENHA_DA_FICHA"
```

O personagem e as URLs já estão configurados para **Han Zhen**.

> Atenção: este repositório está público. Se colocar as senhas diretamente no `config.json`, elas ficarão no histórico do GitHub. Use somente credenciais exclusivas desse RPG, que não sejam reutilizadas em e-mail, Steam, banco ou outros serviços. O bot também aceita os Secrets opcionais `DAEVA_USER`, `DAEVA_PASSWORD` e `DAEVA_SHEET_PASSWORD`.

## Como testar na hora

1. Abra a aba **Actions** do repositório.
2. Entre em **Daeva - Auto Meditar**.
3. Clique em **Run workflow**.
4. Abra a execução para acompanhar os logs.

## Segurança e diagnóstico

- O bot nunca imprime as senhas nos logs.
- O HTML de diagnóstico passa por remoção dos valores configurados de e-mail/senhas.
- O clique em meditação é feito uma única vez por execução.
- Screenshots e HTML de diagnóstico ficam nos artifacts da execução por 7 dias para facilitar ajustes caso o site mude.
- O servidor do jogo continua sendo a autoridade final para aceitar ou rejeitar uma meditação.

## URL atual da ficha

`https://site-fichas-daeva1.vercel.app/ficha/1cbcd154-91e0-4cb7-8049-cafb923ecfac`
