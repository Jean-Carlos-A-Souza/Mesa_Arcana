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

function carregarConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  config.email = process.env.DAEVA_USER || config.email || config.usuario;
  config.senhaLogin = process.env.DAEVA_PASSWORD || config.senhaLogin || config.senha;
  config.senhaFicha = process.env.DAEVA_SHEET_PASSWORD || config.senhaFicha;

  if (!config.fichaUrl) throw new Error('fichaUrl não configurada.');
  if (!config.loginUrl) config.loginUrl = `${new URL(config.fichaUrl).origin}/login`;

  sensitiveValues = [config.email, config.senhaLogin, config.senhaFicha]
    .map(v => String(v || '').trim())
    .filter(Boolean);

  return config;
}

function validarConfig(config) {
  const faltando = [];
  if (!config.email || String(config.email).includes('COLOQUE_')) faltando.push('email');
  if (!config.senhaLogin || String(config.senhaLogin).includes('COLOQUE_')) faltando.push('senhaLogin');
  if (!config.senhaFicha || String(config.senhaFicha).includes('COLOQUE_')) faltando.push('senhaFicha');
  if (faltando.length) throw new Error(`Preencha no config.json: ${faltando.join(', ')}.`);
}

function limparSegredos(texto) {
  let output = String(texto ?? '');
  for (const value of sensitiveValues) output = output.split(value).join('***');
  return output;
}

async function salvarDiagnostico(page, prefix) {
  try {
    await page.screenshot({ path: path.join(ARTIFACTS, `${prefix}.png`), fullPage: true });
  } catch (_) {}

  try {
    const html = limparSegredos(await page.content());
    fs.writeFileSync(path.join(ARTIFACTS, `${prefix}.html`), html, 'utf8');
  } catch (_) {}
}

async function primeiroVisivel(page, selectors) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) return loc;
  }
  return null;
}

async function fazerLogin(page, config) {
  log('Abrindo tela de login.');
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const email = await primeiroVisivel(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="exemplo.com" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="e-mail" i]'
  ]);
  const senha = await primeiroVisivel(page, ['input[type="password"]']);

  if (!email || !senha) {
    await salvarDiagnostico(page, 'erro-tela-login');
    throw new Error('Campos de login não encontrados.');
  }

  await email.fill(String(config.email));
  await senha.fill(String(config.senhaLogin));

  let entrar = page.getByRole('button', { name: /^entrar$/i }).last();
  if (!(await entrar.isVisible().catch(() => false))) {
    entrar = page.locator('button[type="submit"]').last();
  }

  log('Enviando login.');
  await entrar.click({ timeout: 7000 });
  await page.waitForTimeout(1800);

  if (page.url().toLowerCase().includes('/login')) {
    await salvarDiagnostico(page, 'erro-login-rejeitado');
    throw new Error('O login não avançou. Confira e-mail e senha de login.');
  }

  log('Login concluído.');
}

function mesmaFichaAtual(page, config) {
  try {
    const atual = new URL(page.url());
    const alvo = new URL(config.fichaUrl);
    return atual.origin === alvo.origin && atual.pathname === alvo.pathname;
  } catch (_) {
    return false;
  }
}

async function abrirSomenteFicha(page, config) {
  log('Abrindo diretamente a ficha configurada.');
  await page.goto(config.fichaUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  if (page.url().toLowerCase().includes('/login')) {
    throw new Error('A sessão não permaneceu autenticada ao abrir a ficha.');
  }

  if (!mesmaFichaAtual(page, config)) {
    await salvarDiagnostico(page, 'erro-url-ficha');
    throw new Error('A página atual não é a ficha configurada. Nenhum clique será feito.');
  }

  log('Ficha correta aberta pela URL direta.');
}

async function desbloquearFicha(page, config) {
  const tituloProtegida = page.getByText(/ficha protegida/i).first();
  const estaProtegida = await tituloProtegida.isVisible().catch(() => false);

  if (!estaProtegida) {
    log('Ficha já está revelada nesta sessão.');
    return;
  }

  log('Ficha protegida detectada. Inserindo senha da ficha.');

  const senha = await primeiroVisivel(page, [
    'input[placeholder*="senha da ficha" i]',
    'input[type="password"]'
  ]);
  const revelar = page.getByRole('button', { name: /revelar ficha/i }).first();

  if (!senha || !(await revelar.isVisible().catch(() => false))) {
    await salvarDiagnostico(page, 'erro-desbloqueio-ficha');
    throw new Error('Não encontrei o campo/botão de desbloqueio da ficha.');
  }

  await senha.fill(String(config.senhaFicha));
  await revelar.click({ timeout: 7000 });
  await page.waitForTimeout(1200);

  if (await tituloProtegida.isVisible().catch(() => false)) {
    await salvarDiagnostico(page, 'erro-senha-ficha');
    throw new Error('A ficha continuou bloqueada. Confira a senha da ficha.');
  }

  log('Ficha revelada com sucesso.');
}

async function encontrarBotaoMeditar(page) {
  const grupos = [
    page.getByRole('button', { name: /\+?\s*1\s*qi/i }),
    page.getByRole('button', { name: /meditar/i }),
    page.locator('button:has-text("+1 QI")'),
    page.locator('button:has-text("Meditar")')
  ];

  for (const grupo of grupos) {
    const count = await grupo.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const item = grupo.nth(i);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

async function estaDisponivel(button) {
  if (!(await button.isVisible().catch(() => false))) return false;
  if (!(await button.isEnabled().catch(() => false))) return false;

  return button.evaluate(el => {
    const style = getComputedStyle(el);
    return !(
      el.getAttribute('aria-disabled') === 'true' ||
      style.pointerEvents === 'none' ||
      style.visibility === 'hidden' ||
      style.display === 'none' ||
      String(el.className || '').toLowerCase().includes('cursor-not-allowed')
    );
  }).catch(() => false);
}

async function tentarMeditar(page, config) {
  if (!mesmaFichaAtual(page, config)) {
    throw new Error('Proteção acionada: fora da ficha configurada. Nenhum clique será feito.');
  }

  const botao = await encontrarBotaoMeditar(page);
  if (!botao) {
    log('Botão +1 QI/Meditar não encontrado nesta verificação. Nada será clicado.');
    await salvarDiagnostico(page, 'meditar-nao-encontrado');
    return;
  }

  if (!(await estaDisponivel(botao))) {
    log('Meditar está indisponível. Nada será clicado.');
    await salvarDiagnostico(page, 'meditar-indisponivel');
    return;
  }

  if (!mesmaFichaAtual(page, config)) {
    throw new Error('Proteção acionada antes do clique: URL da ficha mudou.');
  }

  log('Meditação disponível. Clicando uma única vez em +1 QI.');
  await botao.click({ timeout: 7000 });
  await page.waitForTimeout(1800);

  const depois = await encontrarBotaoMeditar(page);
  if (!depois || !(await estaDisponivel(depois))) {
    log('Meditação confirmada pela interface: botão ficou indisponível.');
  } else {
    log('Clique enviado, mas o botão ainda parece habilitado. O bot não fará segundo clique nesta execução.');
  }

  await salvarDiagnostico(page, 'meditacao-realizada');
}

async function executar() {
  const config = carregarConfig();
  validarConfig(config);

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
    page.setDefaultTimeout(Number(config.timeoutMs || 30000));

    await fazerLogin(page, config);
    await abrirSomenteFicha(page, config);
    await desbloquearFicha(page, config);
    await tentarMeditar(page, config);

    log('Execução finalizada.');
  } catch (error) {
    log(`ERRO: ${error.message}`);
    if (page) await salvarDiagnostico(page, 'erro-execucao');
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

executar();
