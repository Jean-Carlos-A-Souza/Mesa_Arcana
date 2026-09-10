const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = __dirname;
const ARTIFACTS = path.join(ROOT, 'artifacts');
const CONFIG_PATH = path.join(ROOT, 'config.json');

fs.mkdirSync(ARTIFACTS, { recursive: true });
let sensitiveValues = [];

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

function limparSegredos(texto) {
  let output = String(texto ?? '');
  for (const value of sensitiveValues) {
    if (!value) continue;
    output = output.split(value).join('***');
  }
  return output;
}

function carregarConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config.json não encontrado.');
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  // Compatibilidade com a primeira versão do config.
  config.email = process.env.DAEVA_USER || config.email || config.usuario;
  config.senhaLogin = process.env.DAEVA_PASSWORD || config.senhaLogin || config.senha;
  config.senhaFicha = process.env.DAEVA_SHEET_PASSWORD || config.senhaFicha;
  config.personagem = config.personagem || 'Han Zhen';

  if (!config.fichaUrl) {
    throw new Error('fichaUrl não foi configurada.');
  }

  if (!config.loginUrl) {
    const origin = new URL(config.fichaUrl).origin;
    config.loginUrl = `${origin}/login`;
  }

  if (!config.homeUrl) {
    config.homeUrl = new URL(config.fichaUrl).origin;
  }

  sensitiveValues = [config.email, config.senhaLogin, config.senhaFicha]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return config;
}

function valorReal(value, placeholders = []) {
  const text = String(value || '').trim();
  if (!text) return false;
  return !placeholders.some((p) => text.includes(p));
}

function validarConfig(config) {
  const faltando = [];

  if (!valorReal(config.email, ['COLOQUE_SEU_EMAIL', 'COLOQUE_SEU_USUARIO'])) {
    faltando.push('email');
  }
  if (!valorReal(config.senhaLogin, ['COLOQUE_SUA_SENHA', 'COLOQUE_A_SENHA_DE_LOGIN'])) {
    faltando.push('senhaLogin');
  }
  if (!valorReal(config.senhaFicha, ['COLOQUE_A_SENHA_DA_FICHA', 'COLOQUE_SUA_SENHA_DA_FICHA'])) {
    faltando.push('senhaFicha');
  }

  if (faltando.length) {
    throw new Error(`Preencha no config.json: ${faltando.join(', ')}.`);
  }
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
    const html = limparSegredos(await page.content());
    fs.writeFileSync(path.join(ARTIFACTS, `${safePrefix}.html`), html, 'utf8');
  } catch (_) {}
}

async function telaDeLogin(page) {
  const email = await primeiroVisivel(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="exemplo.com" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="e-mail" i]'
  ]);
  const password = await primeiroVisivel(page, ['input[type="password"]']);
  return Boolean(email && password);
}

async function fazerLogin(page, config) {
  log('Abrindo tela de login.');
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  if (!(await telaDeLogin(page))) {
    await salvarDiagnostico(page, 'erro-tela-login');
    throw new Error('A tela de login não foi reconhecida.');
  }

  const email = await primeiroVisivel(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="exemplo.com" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="e-mail" i]'
  ]);
  const password = await primeiroVisivel(page, ['input[type="password"]']);

  await email.fill(String(config.email));
  await password.fill(String(config.senhaLogin));

  let submit = null;

  const form = password.locator('xpath=ancestor::form[1]');
  if ((await form.count().catch(() => 0)) > 0) {
    const candidate = form.locator('button[type="submit"], input[type="submit"]').last();
    if ((await candidate.count().catch(() => 0)) > 0 && (await candidate.isVisible().catch(() => false))) {
      submit = candidate;
    }
  }

  if (!submit) {
    const byText = page.getByRole('button', { name: /^entrar$/i });
    const count = await byText.count().catch(() => 0);
    for (let i = count - 1; i >= 0; i--) {
      const candidate = byText.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        submit = candidate;
        break;
      }
    }
  }

  log('Enviando login.');
  if (submit) {
    await submit.click({ timeout: 7000 });
  } else {
    await password.press('Enter');
  }

  await Promise.race([
    page.waitForURL((url) => !url.pathname.toLowerCase().includes('/login'), { timeout: 12000 }).catch(() => null),
    page.getByText(/fichas de personagem/i).first().waitFor({ state: 'visible', timeout: 12000 }).catch(() => null)
  ]);
  await page.waitForTimeout(1000);

  if (await telaDeLogin(page)) {
    await salvarDiagnostico(page, 'erro-login-rejeitado');
    throw new Error('O login não avançou. Confira o e-mail e a senha de login.');
  }

  log('Login concluído.');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function abrirFichaDoPersonagem(page, config) {
  log(`Procurando a ficha "${config.personagem}" na página principal.`);

  if (!page.url().startsWith(config.homeUrl)) {
    await page.goto(config.homeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
  }

  const nome = page.getByText(new RegExp(`^${escapeRegExp(config.personagem)}$`, 'i')).first();

  if ((await nome.count().catch(() => 0)) > 0 && (await nome.isVisible().catch(() => false))) {
    await nome.scrollIntoViewIfNeeded().catch(() => {});
    await nome.click({ timeout: 7000 }).catch(() => null);
    await page.waitForTimeout(1500);
  }

  if (!page.url().includes('/ficha/')) {
    log('Abertura pelo cartão não foi confirmada; usando a URL configurada da ficha como fallback.');
    await page.goto(config.fichaUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
  }

  if (!page.url().includes('/ficha/')) {
    await salvarDiagnostico(page, 'erro-abrir-ficha');
    throw new Error('Não foi possível abrir a ficha do personagem.');
  }

  log('Ficha aberta.');
}

async function fichaEstaProtegida(page) {
  const heading = page.getByText(/ficha protegida/i).first();
  if (await heading.isVisible().catch(() => false)) return true;

  const input = await primeiroVisivel(page, [
    'input[placeholder*="senha da ficha" i]',
    'input[type="password"]'
  ]);
  const reveal = page.getByRole('button', { name: /revelar ficha/i }).first();
  return Boolean(input && (await reveal.isVisible().catch(() => false)));
}

async function desbloquearFicha(page, config) {
  if (!(await fichaEstaProtegida(page))) {
    log('A ficha já está revelada nesta sessão.');
    return;
  }

  log('Ficha protegida detectada. Inserindo a senha da ficha.');

  const password = await primeiroVisivel(page, [
    'input[placeholder*="senha da ficha" i]',
    'input[type="password"]'
  ]);
  const reveal = page.getByRole('button', { name: /revelar ficha/i }).first();

  if (!password || !(await reveal.isVisible().catch(() => false))) {
    await salvarDiagnostico(page, 'erro-campos-senha-ficha');
    throw new Error('Não consegui identificar o campo/botão para revelar a ficha.');
  }

  await password.fill(String(config.senhaFicha));
  await reveal.click({ timeout: 7000 });
  await page.waitForTimeout(1500);

  if (await fichaEstaProtegida(page)) {
    await salvarDiagnostico(page, 'erro-senha-ficha');
    throw new Error('A ficha continuou bloqueada. Confira a senha da ficha.');
  }

  log('Ficha revelada com sucesso.');
}

async function encontrarBotaoMeditar(page) {
  const candidates = [
    page.getByRole('button', { name: /\+?\s*1\s*qi/i }),
    page.getByRole('button', { name: /meditar/i }),
    page.locator('button:has-text("+1 QI")'),
    page.locator('button:has-text("1 QI")'),
    page.locator('button:has-text("Meditar")'),
    page.locator('[role="button"]:has-text("+1 QI")'),
    page.locator('[role="button"]:has-text("Meditar")')
  ];

  for (const group of candidates) {
    const count = await group.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const locator = group.nth(i);
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }

  const text = page.getByText(/^meditar$/i).first();
  if (await text.isVisible().catch(() => false)) {
    const clickable = text.locator('xpath=ancestor-or-self::button[1]').first();
    if ((await clickable.count().catch(() => 0)) > 0) return clickable;

    const parentButton = text.locator('xpath=preceding-sibling::button[1]').first();
    if ((await parentButton.count().catch(() => 0)) > 0 && (await parentButton.isVisible().catch(() => false))) {
      return parentButton;
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

      return !(
        nativeDisabled ||
        ariaDisabled === 'true' ||
        style.pointerEvents === 'none' ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        /(^|\s)disabled(\s|$)/.test(className) ||
        className.includes('cursor-not-allowed') ||
        className.includes('pointer-events-none')
      );
    });
  } catch (_) {
    return false;
  }
}

async function clicarMeditar(page, config) {
  const button = await encontrarBotaoMeditar(page);

  if (!button) {
    log('Botão +1 QI/Meditar não foi encontrado. Provavelmente ainda não está disponível.');
    await salvarDiagnostico(page, 'meditar-nao-encontrado');
    return;
  }

  if (!(await botaoEstaDisponivel(button))) {
    log('Botão de meditação encontrado, mas está desabilitado. Nada será clicado.');
    await salvarDiagnostico(page, 'meditar-indisponivel');
    return;
  }

  const origin = new URL(config.fichaUrl).origin;
  const responsePromise = page
    .waitForResponse(
      (response) => {
        const request = response.request();
        return request.method() !== 'GET' && response.url().startsWith(origin);
      },
      { timeout: 6000 }
    )
    .catch(() => null);

  log('Meditação disponível. Clicando uma única vez em +1 QI.');
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.click({ timeout: 7000 });

  const response = await responsePromise;
  await page.waitForTimeout(1800);

  if (response) {
    log(`Requisição da meditação respondeu HTTP ${response.status()}.`);
  } else {
    log('Clique foi enviado; não houve uma resposta HTTP específica capturada para confirmar a ação.');
  }

  const after = await encontrarBotaoMeditar(page);
  if (!after || !(await botaoEstaDisponivel(after))) {
    log('A interface mudou para indisponível após o clique: meditação confirmada pela UI.');
  } else {
    log('A interface ainda mostra o botão habilitado após o clique; o servidor continuará sendo a proteção contra clique duplicado nas próximas execuções.');
  }

  await salvarDiagnostico(page, 'meditacao-realizada');
}

async function executar() {
  const config = carregarConfig();
  validarConfig(config);

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

    await fazerLogin(page, config);
    await abrirFichaDoPersonagem(page, config);
    await desbloquearFicha(page, config);

    const personagemVisivel = page.getByText(new RegExp(`^${escapeRegExp(config.personagem)}$`, 'i')).first();
    if (!(await personagemVisivel.isVisible().catch(() => false))) {
      log('Aviso: o nome do personagem não foi encontrado no conteúdo revelado, mas a rota da ficha foi aberta.');
    }

    await clicarMeditar(page, config);
    log('Execução finalizada.');
  } catch (error) {
    log(`ERRO: ${limparSegredos(error.message)}`);
    if (page) await salvarDiagnostico(page, 'erro-execucao');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

executar();
