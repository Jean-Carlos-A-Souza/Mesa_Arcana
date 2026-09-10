const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const ARTIFACTS = path.join(ROOT, 'artifacts');
const CONFIG_PATH = path.join(ROOT, 'config.json');

fs.mkdirSync(ARTIFACTS, { recursive: true });

function horarioBrasil() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  }).format(new Date());
}

function log(message) {
  console.log(`[${horarioBrasil()}] ${message}`);
}

function carregarConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config.json não encontrado.');
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  config.usuario = process.env.DAEVA_USER || config.usuario;
  config.senha = process.env.DAEVA_PASSWORD || config.senha;

  if (!config.fichaUrl) {
    throw new Error('fichaUrl não foi configurada.');
  }

  return config;
}

function credenciaisConfiguradas(config) {
  const usuario = String(config.usuario || '').trim();
  const senha = String(config.senha || '').trim();

  return Boolean(
    usuario &&
    senha &&
    !usuario.includes('COLOQUE_SEU_USUARIO') &&
    !senha.includes('COLOQUE_SUA_SENHA')
  );
}

async function primeiroVisivel(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) > 0 && (await locator.isVisible())) {
        return locator;
      }
    } catch (_) {}
  }
  return null;
}

async function salvarDiagnostico(page, prefix) {
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, '_');
  try {
    await page.screenshot({
      path: path.join(ARTIFACTS, `${safePrefix}.png`),
      fullPage: true
    });
  } catch (_) {}

  try {
    fs.writeFileSync(
      path.join(ARTIFACTS, `${safePrefix}.html`),
      await page.content(),
      'utf8'
    );
  } catch (_) {}
}

async function paginaTemLogin(page) {
  const password = page.locator('input[type="password"]').first();
  try {
    return (await password.count()) > 0 && (await password.isVisible());
  } catch (_) {
    return false;
  }
}

async function fazerLoginSeNecessario(page, config) {
  if (!(await paginaTemLogin(page))) {
    log('Sessão já autenticada ou a ficha não exigiu login nesta etapa.');
    return;
  }

  log('Tela de login detectada. Preenchendo as credenciais.');

  const userSelectors = [
    'input[name="username"]',
    'input[name="usuario"]',
    'input[name="user"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="usuário" i]',
    'input[placeholder*="usuario" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="user" i]',
    'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"])'
  ];

  const usuario = await primeiroVisivel(page, userSelectors);
  const senha = await primeiroVisivel(page, ['input[type="password"]']);

  if (!usuario || !senha) {
    await salvarDiagnostico(page, 'erro-login-campos');
    throw new Error('Não consegui identificar os campos de usuário e senha.');
  }

  await usuario.fill(String(config.usuario));
  await senha.fill(String(config.senha));

  let submit = null;
  const submitByRole = [/entrar/i, /login/i, /acessar/i, /sign\s*in/i];

  for (const name of submitByRole) {
    const candidate = page.getByRole('button', { name }).first();
    try {
      if ((await candidate.count()) > 0 && (await candidate.isVisible())) {
        submit = candidate;
        break;
      }
    } catch (_) {}
  }

  if (!submit) {
    submit = await primeiroVisivel(page, ['button[type="submit"]', 'input[type="submit"]']);
  }

  if (submit) {
    await Promise.allSettled([
      page.waitForLoadState('networkidle', { timeout: 10000 }),
      submit.click({ timeout: 5000 })
    ]);
  } else {
    await senha.press('Enter');
  }

  await page.waitForTimeout(2500);

  if (await paginaTemLogin(page)) {
    await salvarDiagnostico(page, 'erro-login-rejeitado');
    throw new Error('O login continuou na tela. Usuário/senha podem estar incorretos ou o site mudou.');
  }

  log('Login concluído.');
}

async function encontrarBotaoMeditar(page) {
  const roleCandidates = [
    page.getByRole('button', { name: /meditar/i }),
    page.getByRole('button', { name: /\+?\s*1\s*qi/i })
  ];

  for (const group of roleCandidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const locator = group.nth(i);
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }

  const direct = await primeiroVisivel(page, [
    'button:has-text("Meditar")',
    'button:has-text("+1 QI")',
    'button:has-text("1 QI")',
    '[role="button"]:has-text("Meditar")',
    '[role="button"]:has-text("+1 QI")',
    '[role="button"]:has-text("1 QI")'
  ]);
  if (direct) return direct;

  const textCandidates = [
    page.getByText(/meditar/i),
    page.getByText(/\+?\s*1\s*qi/i)
  ];

  for (const group of textCandidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const text = group.nth(i);
      if (!(await text.isVisible().catch(() => false))) continue;

      const clickable = text.locator('xpath=ancestor-or-self::button[1]').first();
      if ((await clickable.count().catch(() => 0)) > 0) return clickable;

      const roleButton = text.locator('xpath=ancestor-or-self::*[@role="button"][1]').first();
      if ((await roleButton.count().catch(() => 0)) > 0) return roleButton;
    }
  }

  return null;
}

async function botaoEstaDisponivel(button) {
  try {
    if (!(await button.isVisible())) return false;
    if (!(await button.isEnabled())) return false;

    return await button.evaluate((el) => {
      const style = window.getComputedStyle(el);
      const className = String(el.className || '').toLowerCase();
      const ariaDisabled = el.getAttribute('aria-disabled');
      const nativeDisabled = 'disabled' in el ? Boolean(el.disabled) : false;

      const looksDisabled =
        nativeDisabled ||
        ariaDisabled === 'true' ||
        style.pointerEvents === 'none' ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        /(^|\s)disabled(\s|$)/.test(className) ||
        className.includes('cursor-not-allowed') ||
        className.includes('pointer-events-none');

      return !looksDisabled;
    });
  } catch (_) {
    return false;
  }
}

async function executar() {
  const config = carregarConfig();

  if (!credenciaisConfiguradas(config)) {
    log('Credenciais ainda não configuradas. Edite usuario e senha no config.json ou use os Secrets DAEVA_USER e DAEVA_PASSWORD.');
    return;
  }

  const timeoutMs = Number(config.timeoutMs || 30000);
  let browser;
  let page;

  try {
    browser = await chromium.launch({
      headless: config.headless !== false,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const context = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1440, height: 1100 }
    });

    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    const primeiraUrl = config.loginUrl || config.fichaUrl;
    log(`Abrindo ${config.loginUrl ? 'a tela de login' : 'a ficha'}...`);
    await page.goto(primeiraUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(1500);

    await fazerLoginSeNecessario(page, config);

    if (!page.url().startsWith(config.fichaUrl)) {
      log('Abrindo a ficha do personagem.');
      await page.goto(config.fichaUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await page.waitForTimeout(2000);
      await fazerLoginSeNecessario(page, config);
    }

    const button = await encontrarBotaoMeditar(page);

    if (!button) {
      log('Botão Meditar/+1 QI não encontrado nesta execução.');
      await salvarDiagnostico(page, 'botao-nao-encontrado');
      return;
    }

    const disponivel = await botaoEstaDisponivel(button);

    if (!disponivel) {
      log('Meditar encontrado, porém ainda está indisponível. Nada será clicado.');
      await salvarDiagnostico(page, 'meditar-indisponivel');
      return;
    }

    const textoAntes = (await button.innerText().catch(() => 'Meditar')).trim().replace(/\s+/g, ' ');
    log(`Meditar está disponível (${textoAntes || 'botão encontrado'}). Clicando uma vez...`);

    await button.scrollIntoViewIfNeeded();
    await button.click({ timeout: 7000 });
    await page.waitForTimeout(3000);

    await salvarDiagnostico(page, 'meditacao-realizada');
    log('Clique de meditação enviado. Execução concluída.');
  } catch (error) {
    log(`ERRO: ${error.message}`);
    if (page) await salvarDiagnostico(page, 'erro-execucao');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

executar();
