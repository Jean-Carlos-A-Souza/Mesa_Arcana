# Daeva - Auto Meditar

Bot em Playwright que roda no **GitHub Actions** e executa sozinho o caminho completo do Daeva até a meditação. Ele não depende do seu computador estar ligado.

## Fluxo

1. Abre a URL de login configurada em `loginUrl`.
2. Preenche `email` e `senhaLogin` do `config.json`.
3. Entra na página principal configurada em `homeUrl`.
4. Procura exatamente o personagem definido em `personagem`.
5. Tenta abrir o cartão desse personagem.
6. Se o cartão não abrir e `fichaUrl` estiver preenchido, usa essa URL como fallback.
7. Se aparecer **Ficha Protegida**, preenche `senhaFicha` e clica em **Revelar Ficha**.
8. Confirma dentro da ficha que o nome visível é exatamente o mesmo de `personagem`.
9. Procura **+1 QI / Meditar**.
10. Só clica se o botão estiver visível e habilitado.
11. Faz no máximo um clique por execução.

O workflow executa automaticamente **a cada 2 horas** e também pode ser iniciado manualmente pela aba **Actions**.

## Configuração

Tudo que muda de jogador para jogador fica no `config.json`:

```json
{
  "loginUrl": "https://site-fichas-daeva1.vercel.app/login",
  "homeUrl": "https://site-fichas-daeva1.vercel.app",
  "fichaUrl": "URL_DA_FICHA_DO_PERSONAGEM",
  "personagem": "NOME_EXATO_DO_PERSONAGEM",
  "email": "SEU_EMAIL",
  "senhaLogin": "SUA_SENHA_DE_LOGIN",
  "senhaFicha": "SUA_SENHA_DA_FICHA",
  "headless": true,
  "timeoutMs": 30000
}
```

`fichaUrl` é recomendada porque funciona como fallback e como trava de segurança. Se ela estiver preenchida, o bot só aceita meditar nessa URL exata. O nome em `personagem` também é validado dentro da ficha antes do clique.

## Para outro jogador usar

A forma mais simples é copiar/forkar este repositório para a própria conta do GitHub e alterar somente o `config.json` com:

- `personagem`: nome exato do boneco;
- `email`: e-mail usado no login;
- `senhaLogin`: senha da conta;
- `senhaFicha`: senha específica da ficha;
- `fichaUrl`: URL da ficha desse personagem.

Depois de fazer commit no `config.json`, o próprio GitHub Actions dispara um teste automático. Se funcionar, o agendamento de 2 em 2 horas continua sozinho.

> Atenção: se o repositório for público, qualquer senha colocada diretamente no `config.json` fica visível no histórico do GitHub. Use apenas credenciais exclusivas desse RPG ou prefira os GitHub Secrets opcionais `DAEVA_USER`, `DAEVA_PASSWORD` e `DAEVA_SHEET_PASSWORD`.

## Como testar na hora

1. Abra a aba **Actions** do repositório.
2. Entre em **Daeva - Auto Meditar**.
3. Clique em **Run workflow**.
4. Abra a execução para acompanhar os logs.

## Segurança e diagnóstico

- O bot nunca imprime as senhas nos logs.
- O HTML de diagnóstico remove os valores configurados de e-mail e senhas.
- O clique em meditação é feito uma única vez por execução.
- Se `fichaUrl` estiver configurada, o bot aborta se estiver em outra ficha.
- O nome do personagem também precisa bater com `personagem` antes do clique.
- Screenshots e HTML de diagnóstico ficam nos artifacts da execução por 7 dias.
- O servidor do jogo continua sendo a autoridade final para aceitar ou rejeitar uma meditação.
