/**
 * 브라우저 자동화 도구 준비 확인.
 *
 * 이 스크립트들은 실제 브라우저에서 앱을 돌린다. Playwright 가 없으면
 * 'Cannot find module' 같은 메시지만 뜨는데, 처음 쓰는 사람에게는 무엇을 하라는 건지
 * 알 수 없다. 무엇이 없고 무엇을 치면 되는지 알려준다.
 */
export async function loadPlaywright() {
  const override = process.env.PLAYWRIGHT_PATH;
  const targets = override ? [override, 'playwright'] : ['playwright'];
  let lastError;
  for (const t of targets) {
    try {
      return await import(t);
    } catch (err) {
      lastError = err;
    }
  }
  console.error(`
브라우저 자동화 도구(Playwright)가 없어 실행할 수 없습니다.

  다음 한 줄을 먼저 실행하세요:

      npm run setup:sim

  (또는 직접:  npm i -D playwright && npx playwright install chromium)

  이미 다른 위치에 설치돼 있다면 PLAYWRIGHT_PATH 로 지정할 수 있습니다:
      PLAYWRIGHT_PATH=/경로/playwright/index.mjs npm run simulate
`);
  if (process.env.DEBUG) console.error(lastError);
  process.exit(1);
}

/** 서버를 띄우고 준비될 때까지 기다린다 (죽을 때 반드시 정리한다) */
export async function startServer(spawn, { cwd, port, db, env = {} }) {
  const server = spawn('node', ['server/index.js'], {
    cwd,
    env: { ...process.env, PORT: String(port), SKINLAB_DB: db, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stop = () => { try { server.kill(); } catch { /* 이미 종료 */ } };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });
  process.on('uncaughtException', (e) => { stop(); console.error(e); process.exit(1); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`서버가 ${port} 포트에서 뜨지 않았습니다. 이미 쓰고 있는 프로세스가 있는지 확인하세요.`)), 15000);
    server.stdout.on('data', (b) => { if (String(b).includes('SkinLab')) { clearTimeout(timer); resolve(); } });
  });
  return { server, stop };
}
