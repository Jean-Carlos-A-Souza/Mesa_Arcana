# Daeva - Auto Meditar

Bot em Playwright que roda no **GitHub Actions**, abre a ficha do personagem e clica em **Meditar / +1 QI** quando o botão estiver disponível.

Ele não depende do seu computador estar ligado.

## O que você precisa preencher

Abra `config.json` e troque somente estas duas linhas:

```json
"usuario": "COLOQUE_SEU_USUARIO_AQUI",
"senha": "COLOQUE_SUA_SENHA_AQUI"
```

> Atenção: este repositório está público. Se essa senha for usada em qualquer outro serviço, NÃO coloque a senha no arquivo. Nesse caso use GitHub Secrets `DAEVA_USER` e `DAEVA_PASSWORD`.

## Como testar na hora

1. Abra a aba **Actions** do repositório.
2. Entre em **Daeva - Auto Meditar**.
3. Clique em **Run workflow**.
4. Abra a execução para ver os logs.

Depois disso o GitHub executa o bot automaticamente a cada **15 minutos**.

## Como funciona

1. Abre a ficha configurada.
2. Se aparecer login, procura os campos de usuário e senha automaticamente.
3. Faz o login.
4. Volta para a ficha.
5. Procura um botão com `Meditar`, `+1 QI` ou `1 QI`.
6. Se estiver desabilitado, encerra sem clicar.
7. Se estiver habilitado, clica **uma única vez**.
8. Salva screenshot/HTML de diagnóstico por 7 dias nos artifacts da execução.

## Se o site mudar

O bot usa vários seletores de fallback para o login e para o botão de meditação. Se o layout mudar e ele deixar de encontrar algo, os artifacts da execução guardam screenshot e HTML para facilitar o ajuste.

## URL atual da ficha

`https://site-fichas-daeva1.vercel.app/ficha/1cbcd154-91e0-4cb7-8049-cafb923ecfac`
