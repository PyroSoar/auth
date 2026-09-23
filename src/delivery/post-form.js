const { callbackFields } = require('../security/identity-assertion');

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formInputs(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => {
      const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(serialized)}">`;
    }).join('\n');
}

function buildPostForm(action, identity) {
  const fields = callbackFields(action, identity);
  const displayName = typeof identity.name === 'string' ? identity.name.trim().slice(0, 200) : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f4f7ff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0b1020" media="(prefers-color-scheme: dark)">
  <title>Completing sign-in</title>
  <style>
    :root {
      color-scheme: light dark;
      --page: #f4f7ff;
      --page-accent: #e8edff;
      --card: rgba(255, 255, 255, .82);
      --card-border: rgba(77, 94, 145, .16);
      --text: #182036;
      --muted: #68718a;
      --accent: #5b67e8;
      --accent-strong: #4351d4;
      --accent-soft: rgba(91, 103, 232, .13);
      --shadow: 0 24px 70px rgba(45, 55, 100, .16);
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      display: grid;
      min-height: 100vh;
      min-height: 100dvh;
      margin: 0;
      padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
      place-items: center;
      overflow: hidden;
      background:
        radial-gradient(circle at 18% 16%, rgba(112, 127, 255, .22), transparent 35%),
        radial-gradient(circle at 84% 82%, rgba(137, 91, 232, .16), transparent 36%),
        linear-gradient(145deg, var(--page), var(--page-accent));
      color: var(--text);
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      position: relative;
      width: min(100%, 420px);
      padding: 42px 36px 34px;
      overflow: hidden;
      border: 1px solid var(--card-border);
      border-radius: 28px;
      background: var(--card);
      box-shadow: var(--shadow);
      text-align: center;
      -webkit-backdrop-filter: blur(22px) saturate(135%);
      backdrop-filter: blur(22px) saturate(135%);
    }
    .card::before {
      content: "";
      position: absolute;
      inset: 0 0 auto;
      height: 3px;
      background: linear-gradient(90deg, #7c86f6, #965de1, #5f7ae8);
    }
    .status-mark {
      display: grid;
      position: relative;
      width: 76px;
      height: 76px;
      margin: 0 auto 26px;
      place-items: center;
      border-radius: 24px;
      background: linear-gradient(145deg, var(--accent), var(--accent-strong));
      box-shadow: 0 14px 30px rgba(73, 84, 210, .28);
      color: white;
    }
    .status-mark::after {
      content: "";
      position: absolute;
      inset: -7px;
      border: 2px solid var(--accent-soft);
      border-top-color: var(--accent);
      border-radius: 29px;
      animation: orbit 1.35s linear infinite;
    }
    .status-mark svg { width: 35px; height: 35px; }
    h1 {
      margin: 0;
      font-size: clamp(23px, 5vw, 28px);
      font-weight: 720;
      letter-spacing: -.035em;
      line-height: 1.18;
    }
    .message {
      max-width: 310px;
      margin: 13px auto 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.65;
    }
    .username {
      display: inline-flex;
      max-width: 100%;
      margin: 16px auto -2px;
      padding: 6px 11px;
      overflow: hidden;
      border: 1px solid var(--card-border);
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--text);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .progress {
      display: flex;
      width: max-content;
      margin: 25px auto 0;
      gap: 7px;
    }
    .progress span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      animation: bounce 1.15s ease-in-out infinite;
    }
    .progress span:nth-child(2) { animation-delay: .14s; }
    .progress span:nth-child(3) { animation-delay: .28s; }
    .fallback { margin: 22px 0 0; color: var(--muted); font-size: 14px; }
    .continue-button {
      display: inline-flex;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      margin-top: 12px;
      padding: 0 22px;
      border: 0;
      border-radius: 12px;
      background: var(--accent);
      color: white;
      cursor: pointer;
      font: inherit;
      font-weight: 650;
    }
    .continue-button:hover { background: var(--accent-strong); }
    .continue-button:focus-visible { outline: 3px solid var(--accent-soft); outline-offset: 3px; }
    @keyframes orbit { to { transform: rotate(360deg); } }
    @keyframes bounce {
      0%, 60%, 100% { opacity: .3; transform: translateY(0); }
      30% { opacity: 1; transform: translateY(-4px); }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page: #090e1c;
        --page-accent: #11172a;
        --card: rgba(18, 24, 43, .82);
        --card-border: rgba(175, 188, 255, .14);
        --text: #f4f6ff;
        --muted: #a7b0c7;
        --accent: #8791ff;
        --accent-strong: #717def;
        --accent-soft: rgba(135, 145, 255, .2);
        --shadow: 0 28px 80px rgba(0, 0, 0, .42);
      }
      body {
        background:
          radial-gradient(circle at 18% 16%, rgba(81, 96, 215, .25), transparent 38%),
          radial-gradient(circle at 84% 82%, rgba(125, 65, 181, .2), transparent 38%),
          linear-gradient(145deg, var(--page), var(--page-accent));
      }
      .status-mark { color: #0b1020; box-shadow: 0 14px 34px rgba(75, 87, 219, .26); }
    }
    @media (max-width: 480px) {
      .card { padding: 36px 24px 30px; border-radius: 24px; }
      .status-mark { width: 70px; height: 70px; border-radius: 22px; }
      .status-mark::after { border-radius: 27px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .status-mark::after, .progress span { animation: none; }
      .progress span { opacity: .65; }
    }
  </style>
</head>
<body>
  <main class="card" aria-labelledby="status-title" aria-describedby="status-message">
    <div class="status-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h1 id="status-title">Authorization complete</h1>
    ${displayName ? `<p id="username" class="username" data-username="${escapeAttribute(displayName)}">Signed in as ${escapeAttribute(displayName)}</p>` : ''}
    <p id="status-message" class="message" role="status" aria-live="polite">
      Returning you securely to the application.
    </p>
    <div class="progress" aria-hidden="true"><span></span><span></span><span></span></div>
    <form id="oauth-result" method="post" action="${escapeAttribute(action)}">
      ${formInputs(fields)}
      <noscript>
        <p class="fallback">Automatic redirection requires JavaScript.</p>
        <button class="continue-button" type="submit">Continue</button>
      </noscript>
    </form>
  </main>
  <script>
    (() => {
      const translations = {
        en: {
          title: 'Completing sign-in', heading: 'Authorization complete',
          message: 'Returning you securely to the application.',
          signedInAs: 'Signed in as {name}', fallback: 'Automatic redirection requires JavaScript.', continue: 'Continue',
        },
        ar: {
          title: 'جارٍ إكمال تسجيل الدخول', heading: 'اكتمل التفويض',
          message: 'تتم إعادتك بأمان إلى التطبيق.',
          signedInAs: 'تم تسجيل الدخول باسم {name}', fallback: 'تتطلب إعادة التوجيه التلقائية JavaScript.', continue: 'متابعة',
        },
        zh: {
          title: '正在完成登录', heading: '授权完成',
          message: '正在安全地返回应用。',
          signedInAs: '已登录为 {name}', fallback: '自动跳转需要 JavaScript。', continue: '继续',
        },
        fr: {
          title: 'Finalisation de la connexion', heading: 'Autorisation terminée',
          message: 'Retour sécurisé vers l’application en cours.',
          signedInAs: 'Connecté en tant que {name}', fallback: 'La redirection automatique nécessite JavaScript.', continue: 'Continuer',
        },
        ru: {
          title: 'Завершение входа', heading: 'Авторизация завершена',
          message: 'Вы будете безопасно возвращены в приложение.',
          signedInAs: 'Выполнен вход: {name}', fallback: 'Для автоматического перенаправления требуется JavaScript.', continue: 'Продолжить',
        },
        es: {
          title: 'Completando el inicio de sesión', heading: 'Autorización completada',
          message: 'Volviendo de forma segura a la aplicación.',
          signedInAs: 'Has iniciado sesión como {name}', fallback: 'La redirección automática requiere JavaScript.', continue: 'Continuar',
        },
      };
      const preferred = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])
        .map(language => String(language || '').toLowerCase().split('-')[0])
        .find(language => Object.prototype.hasOwnProperty.call(translations, language));
      const language = preferred || 'en';
      const copy = translations[language];
      document.documentElement.lang = language;
      document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
      document.title = copy.title;
      document.getElementById('status-title').textContent = copy.heading;
      document.getElementById('status-message').textContent = copy.message;
      const username = document.getElementById('username');
      if (username) username.textContent = copy.signedInAs.replace('{name}', username.dataset.username);
      const fallback = document.querySelector('.fallback');
      if (fallback) fallback.textContent = copy.fallback;
      const button = document.querySelector('.continue-button');
      if (button) button.textContent = copy.continue;
      requestAnimationFrame(() => document.getElementById('oauth-result').submit());
    })();
  </script>
</body>
</html>`;
}

module.exports = { buildPostForm };
