/**
 * 👤 Profile System v2 — EgorNetwork
 *
 * Firestore: users/{uid}
 *   name, bio, avatar (base64 162x162), role, createdAt,
 *   customStatus, social{github,discord,telegram},
 *   techTags[], theme, lastSeen (Timestamp)
 */

'use strict';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const THEMES = [
  { id:'default',   label:'Default',   colors:['#6cd5ff','#8b7bff'] },
  { id:'cyberpunk', label:'Cyberpunk', colors:['#ff2d78','#ff9a00'] },
  { id:'retro',     label:'Retro',     colors:['#39ff14','#ffe600'] },
  { id:'minimal',   label:'Minimal',   colors:['#e8ecff','#a8b3cc'] },
  { id:'sakura',    label:'Sakura',    colors:['#ff85b3','#ffb3d1'] },
  { id:'ocean',     label:'Ocean',     colors:['#00d4ff','#0057ff'] },
  { id:'ember',     label:'Ember',     colors:['#ff6a3d','#ffd166'] },
  { id:'forest',    label:'Forest',    colors:['#34d399','#bef264'] },
  { id:'sunset',    label:'Sunset',    colors:['#ff6b6b','#ffd166'] },
  { id:'arctic',    label:'Arctic',    colors:['#b6f0ff','#5b86e5'] },
  { id:'graphite',  label:'Graphite',  colors:['#d9e2ec','#9aa5b1'] },
  { id:'plasma',    label:'Plasma',    colors:['#ff4db8','#c9a9ff'] },
];

const TECH_SUGGESTIONS = [
  'Linux','Windows','macOS',
  'Unity','Unreal','Godot',
  'JavaScript','TypeScript','Python','Rust','C++','C#','Java','Go',
  'React','Vue','Node.js',
  'AMD','NVIDIA','Intel',
  'VR/AR','Blender','Figma','Photoshop',
  'Git','Docker','Firebase',
];

const SOCIAL_DEFS = [
  { key:'github',   label:'GitHub',   icon:'🐙', placeholder:'username' },
  { key:'discord',  label:'Discord',  icon:'💬', placeholder:'user#0000' },
  { key:'telegram', label:'Telegram', icon:'✈️', placeholder:'@username' },
];

const ALL_ACHIEVEMENTS = {
  first_command:    { title: 'Hello, World!',               desc: 'Первая команда',                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 0 1 2 2v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>' },
  hal_encounter:    { title: "I'm Afraid, Dave",            desc: 'HAL активирован',                   icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></svg>' },
  matrix:           { title: 'Red Pill',                    desc: 'Матрица',                           icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3h4a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z"/><line x1="12" y1="3" x2="12" y2="21"/></svg>' },
  sudo_fail:        { title: 'Permission Denied',           desc: 'Попытка sudo',                      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' },
  calculator:       { title: 'Human Calculator',            desc: 'Калькулятор',                       icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>' },
  quote_master:     { title: 'Wise Words',                  desc: '5 разных цитат',                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z"/></svg>' },
  time_lord:        { title: 'Time Lord',                   desc: 'лето --срочно',                     icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3L2 6"/><path d="M22 6l-3-3"/><path d="M6.38 18.7l-1.73 1.73"/><path d="M17.62 18.7l1.73 1.73"/></svg>' },
  profile_complete: { title: 'Identity',                    desc: 'Bio заполнено',                     icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
  avatar_set:       { title: 'Face Reveal',                 desc: 'Аватар установлен',                 icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' },
  social_linked:    { title: 'Network Node',                desc: 'Соцсеть добавлена',                 icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' },
  hal_survivor:     { title: 'Survivor',                    desc: '30с против HAL',                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' },
  hal_legend:       { title: 'Legendary',                   desc: '60с против HAL',                    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm2 16h16"/></svg>' },
  whoami:           { title: 'WhoAmI',                      desc: 'Кто я?',                            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' },
  login_yourself:   { title: 'EgorNetwork.Login("you");',   desc: 'Авторизоваться снова',              icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>' },
  truckers:         { title: 'Где мой DVD диск?',           desc: 'Попробуйте запустить игру',         icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>' },
  wargames:         { title: 'Термоядерная война?',         desc: 'Хочешь ли ты поиграть в эту игру?', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>' },
  help_all:         { title: 'I can\'t help to all people', desc: 'Мне не хватит сил помочь всем.',    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"/><line x1="23" y1="13" x2="23" y2="11"/><rect x="3" y="8" width="4" height="8" fill="currentColor" stroke="none"/></svg>' },
  nothing_free:     { title: 'Nothing is Free',             desc: 'Ничто не является бесплатным',      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="10"/></svg>' },
  varoom:           { title: 'Varoom!',                     desc: '6000 м в Varoom',                   icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16 L5 14 L8 14"/><circle cx="8" cy="16" r="2"/><circle cx="8" cy="16" r="0.8"/><path d="M10 14 Q13 10 17 11 L19 12"/><path d="M11 13 L14 11.5 L16 12"/><path d="M19 12 L20 14 L20 16"/><path d="M18 11 L21 9 L21 13 L18 12"/><circle cx="17" cy="16" r="2"/><circle cx="17" cy="16" r="0.8"/><path d="M6 16 L19 16"/></svg>' },
  space_warrior:    { title: 'Space Warrior',               desc: 'Пройти 5 волн в Cosmic Defender',   icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },

};

// Было: 2 минуты. Стало: 3 минуты — запас на задержки сети
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;

// ─── UTILS ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function roleBadge(role) {
  return { admin:'role-badge-admin', moderator:'role-badge-moderator',
           user:'role-badge-user' }[role] || 'role-badge-guest';
}
function roleLabel(role) {
  return { admin:'👑 Админ', moderator:'🛡️ Модератор', user:'👤 Участник' }[role] || '👁️ Гость';
}

function formatDate(ts) {
  if (!ts) return 'неизвестно';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
}

function isOnline(ts) {
  if (!ts) return false;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Date.now() - d.getTime() < ONLINE_THRESHOLD_MS;
}

function waitForFirebase(cb, max=25) {
  let n=0;
  const t=setInterval(()=>{
    n++;
    if(window.db&&window.auth){clearInterval(t);cb();}
    else if(n>=max){clearInterval(t);showError('Firebase недоступен.');}
  },300);
}

function showError(msg) {
  const root=document.getElementById('profile-root');
  if(root) root.innerHTML=`<div class="profile-not-found"><h3>😕 Ошибка</h3><p>${esc(msg)}</p></div>`;
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────

function resizeToBase64(file, size=162) { 
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=e=>{
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement('canvas');
        c.width=c.height=size;
        const ctx=c.getContext('2d');
        const min=Math.min(img.width,img.height);
        const sx=(img.width-min)/2, sy=(img.height-min)/2;
        ctx.drawImage(img,sx,sy,min,min,0,0,size,size);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror=reject;
      img.src=e.target.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}

// ─── PARTICLES ────────────────────────────────────────────────────────────────

function spawnParticles(wrap, count=8) {
  if (wrap.querySelector('.avatar-particles')) return;
  const container = document.createElement('div');
  container.className = 'avatar-particles';

  for (let i=0;i<count;i++) {
    const p=document.createElement('div');
    p.className='avatar-particle';
    const angle = (i/count)*360;
    const r1=60+Math.random()*20;
    const r2=80+Math.random()*30;
    const rad1=angle*Math.PI/180;
    const rad2=(angle+30+Math.random()*60)*Math.PI/180;
    p.style.cssText=`
      --x0:${Math.cos(rad1)*r1}px; --y0:${Math.sin(rad1)*r1}px;
      --x1:${Math.cos(rad2)*r2}px; --y1:${Math.sin(rad2)*r2}px;
      --dur:${2+Math.random()*2.5}s; --delay:${Math.random()*3}s;
      top:50%; left:50%;
      background:var(--p-accent);
      width:${3+Math.random()*3}px; height:${3+Math.random()*3}px;
    `;
    container.appendChild(p);
  }
  wrap.appendChild(container);
}

// ─── THEME ────────────────────────────────────────────────────────────────────

function applyTheme(id) {
  THEMES.forEach(t => document.body.classList.remove(`theme-${t.id}`));
  if (id && id !== 'default') document.body.classList.add(`theme-${id}`);
  document.querySelectorAll('.theme-swatch').forEach(s=>{
    s.classList.toggle('active', s.dataset.theme===id);
  });
}

// ─── VIEW SWITCHER ────────────────────────────────────────────────────────────

function applyView(view) {
  document.getElementById('view-default')?.style.setProperty('display', view==='default' ? '' : 'none');
  document.getElementById('view-terminal')?.style.setProperty('display', view==='terminal' ? 'block' : 'none');
  document.getElementById('view-win95')?.style.setProperty('display', view==='win95' ? 'block' : 'none');
  document.querySelectorAll('#view-switcher .view-btn').forEach(b=>{
    b.classList.toggle('active', b.dataset.view===view);
  });
}

function initViewSwitcher(data, uid, isOwn) {
  const switcher = document.getElementById('view-switcher');
  if (!switcher) return;

  const savedView = data.profileView || 'default';

  // Показываем переключатель только владельцу
  if (isOwn) {
    switcher.style.display = 'flex';
    switcher.querySelectorAll('.view-btn').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const view = btn.dataset.view;
        applyView(view);
        // Сохраняем в Firestore — все посетители увидят этот стиль
        try {
          await window.db.collection('users').doc(uid).update({ profileView: view });
        } catch(e) { console.error('Ошибка сохранения вида:', e); }
      });
    });
  }

  // Применяем сохранённый вид для всех
  applyView(savedView);
}

// ─── RENDER: TERMINAL ─────────────────────────────────────────────────────────

function renderTerminal(data, uid) {
  const online = isOnline(data.lastSeen);
  const tags   = (data.techTags||[]).map(t=>`<span class="terminal-tag-chip">${esc(t)}</span>`).join(' ');
  const social = SOCIAL_DEFS
    .filter(s=>data.social?.[s.key])
    .map(s=>`<span class="terminal-tag-chip">${s.icon} ${esc(data.social[s.key])}</span>`)
    .join('');
  
  // Achievements for terminal view
  const unlocked = new Set(data.achievements || []);
  const achList = Object.keys(ALL_ACHIEVEMENTS).map(key => {
    const a = ALL_ACHIEVEMENTS[key];
    const isUnlocked = unlocked.has(key);
    return `<div class="terminal-line" style="margin-left:12px;">
      <span class="terminal-prompt">$ </span>
      <span style="color:${isUnlocked?'#39ff14':'#555'};">
        ${isUnlocked?'✓':'✗'} [${esc(key)}] ${esc(a.title)} — ${esc(a.desc)}
      </span>
    </div>`;
  }).join('');
  const achCount = unlocked.size;
  const achTotal = Object.keys(ALL_ACHIEVEMENTS).length;
  const achPct = Math.round((achCount / achTotal) * 100);

  return `
  <div class="profile-terminal" id="view-terminal" style="display:none;">
    <div class="terminal-bar">
      <div class="terminal-dot" style="background:#ff5f57;"></div>
      <div class="terminal-dot" style="background:#febc2e;"></div>
      <div class="terminal-dot" style="background:#28c840;"></div>
      <span style="margin-left:10px;font-size:.78rem;color:#888;">user-profile — bash</span>
    </div>
    <div class="terminal-body">
      <div class="terminal-line"><span class="terminal-prompt">$ </span><span style="color:#fff;">cat /etc/profile.d/${esc(uid.slice(0,8))}</span></div>
      <div class="terminal-line" style="margin-top:8px;">
        <span class="terminal-key">NAME</span>=<span class="terminal-val">"${esc(data.name||'Unknown')}"</span>
      </div>
      <div class="terminal-line"><span class="terminal-key">ROLE</span>=<span class="terminal-val">"${esc(data.role||'user')}"</span></div>
      <div class="terminal-line"><span class="terminal-key">STATUS</span>=<span style="color:${online?'#39ff14':'#888'};">"${online?'ONLINE':'OFFLINE'}"</span></div>
      ${data.customStatus?`<div class="terminal-line"><span class="terminal-key">MSG</span>=<span class="terminal-val">"${esc(data.customStatus)}"</span></div>`:''}
      ${data.bio?`<div class="terminal-line"><span class="terminal-key">BIO</span>=<span class="terminal-val">"${esc(data.bio)}"</span></div>`:''}
      <div class="terminal-line"><span class="terminal-key">JOINED</span>=<span class="terminal-val">"${formatDate(data.createdAt)}"</span></div>
      ${tags?`<div class="terminal-line" style="margin-top:8px;"><span class="terminal-prompt"># TECH_STACK</span></div><div class="terminal-line">${tags}</div>`:''}
      ${social?`<div class="terminal-line" style="margin-top:8px;"><span class="terminal-prompt"># SOCIAL</span></div><div class="terminal-line">${social}</div>`:''}
      
      <!-- Achievements -->
      <div class="terminal-line" style="margin-top:14px;border-top:1px dashed #333;padding-top:10px;">
        <span class="terminal-prompt"># </span><span style="color:#6cd5ff;">ACHIEVEMENTS</span>
        <span style="color:#888;margin-left:8px;">[${achCount}/${achTotal} · ${achPct}%]</span>
      </div>
      ${achList}
      
      <div class="terminal-line" style="margin-top:12px;"><span class="terminal-prompt">$ </span><span class="terminal-cursor"></span></div>
    </div>
  </div>`;
}

// ─── RENDER: WIN95 ────────────────────────────────────────────────────────────

function renderWin95(data, uid) {
  const online = isOnline(data.lastSeen);
  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" alt="">`
    : `<div style="width:100%;height:100%;background:#000080;display:grid;place-items:center;color:#fff;font-size:1.8rem;font-weight:bold;">${esc((data.name||'U')[0].toUpperCase())}</div>`;
  const tags = (data.techTags||[]).map(t=>`<span class="win95-tag">${esc(t)}</span>`).join('');
  const social = SOCIAL_DEFS
    .filter(s=>data.social?.[s.key])
    .map(s=>`<div class="win95-row"><span class="win95-label">${s.icon} ${s.label}:</span><span class="win95-val">${esc(data.social[s.key])}</span></div>`)
    .join('');
  
  // Achievements for Win95 view
  const unlocked = new Set(data.achievements || []);
  const achList = Object.keys(ALL_ACHIEVEMENTS).map(key => {
    const a = ALL_ACHIEVEMENTS[key];
    const isUnlocked = unlocked.has(key);
    return `<span class="win95-tag" style="${isUnlocked?'':'filter:grayscale(1);opacity:.5;'}" title="${esc(a.desc)}">
      ${isUnlocked?'':'🔒 '}${a.icon} ${esc(a.title)}
    </span>`;
  }).join('');
  const achCount = unlocked.size;
  const achTotal = Object.keys(ALL_ACHIEVEMENTS).length;
  const achPct = Math.round((achCount / achTotal) * 100);

  return `
  <div class="profile-win95" id="view-win95" style="display:none;">
    <div class="win95-titlebar">
      <div class="win95-title">🖥️ User Profile — ${esc(data.name||'Unknown')}</div>
      <div class="win95-controls">
        <div class="win95-btn">_</div>
        <div class="win95-btn">□</div>
        <div class="win95-btn">✕</div>
      </div>
    </div>
    <div class="win95-body">
      <div class="win95-clearfix">
        <div class="win95-avatar">${avatarHtml}</div>
        <div class="win95-row"><span class="win95-label">Имя:</span><span class="win95-val"><b>${esc(data.name||'—')}</b></span></div>
        <div class="win95-row"><span class="win95-label">Роль:</span><span class="win95-val">${esc(data.role||'user')}</span></div>
        <div class="win95-row"><span class="win95-label">Статус:</span><span class="win95-val"><span class="win95-status">${online?'● ONLINE':'○ OFFLINE'}</span></span></div>
        ${data.customStatus?`<div class="win95-row"><span class="win95-label">Сообщение:</span><span class="win95-val">${esc(data.customStatus)}</span></div>`:''}
        <div class="win95-row"><span class="win95-label">Регистрация:</span><span class="win95-val">${formatDate(data.createdAt)}</span></div>
      </div>
      ${data.bio?`
      <div class="win95-section">
        <div class="win95-section-title">О себе</div>
        ${esc(data.bio)}
      </div>`:''}
      ${tags?`
      <div class="win95-section">
        <div class="win95-section-title">Технологии</div>
        ${tags}
      </div>`:''}
      ${social?`
      <div class="win95-section">
        <div class="win95-section-title">Контакты</div>
        ${social}
      </div>`:''}
      
      <!-- Achievements Window -->
      <div class="win95-section">
        <div class="win95-section-title">🏆 Achievements - Season "Summer 2026" [${achCount}/${achTotal}]</div>
        <div style="background:#fff;border:1px inset #808080;padding:8px;margin-top:6px;">
          <div style="background:#000080;color:#fff;font-size:.7rem;padding:2px 6px;margin-bottom:6px;">
            Progress: ${achPct}% ■■■■■■■■■□
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">${achList}</div>
        </div>
      </div>
    </div>
  </div>`;
}

// ─── RENDER: DEFAULT ──────────────────────────────────────────────────────────

function renderAchievements(unlockedList) {
  const allKeys = Object.keys(ALL_ACHIEVEMENTS);
  const unlocked = new Set(unlockedList || []);
  const pct = allKeys.length > 0 ? Math.round((unlocked.size / allKeys.length) * 100) : 0;

  const cards = allKeys.map(key => {
    const a = ALL_ACHIEVEMENTS[key];
    const isUnlocked = unlocked.has(key);
    return `
      <div class="achievement-card ${isUnlocked ? '' : 'locked'}" title="${esc(a.desc)}">
        ${!isUnlocked ? '<span class="ach-lock">🔒</span>' : ''}
        <span class="ach-icon">${a.icon}</span>
        <span class="ach-title">${esc(a.title)}</span>
        <span class="ach-desc">${esc(a.desc)}</span>
      </div>`;
  }).join('');

  return `
    <div class="profile-section">
      <div class="profile-section-label">🏆 Достижения - Сезон "Лето 2026"</div>
      <div class="achievements-progress">
        <span>Получено: <strong style="color:var(--p-accent)">${unlocked.size}</strong> / ${allKeys.length}</span>
        <div class="ach-prog-track"><div class="ach-prog-fill" style="width:${pct}%"></div></div>
        <span style="color:var(--p-accent);font-weight:600;">${pct}%</span>
      </div>
      <div class="achievements-grid">${cards}</div>
    </div>`;
}

function renderDefault(data, uid, isOwn) {
  const online    = isOnline(data.lastSeen);
  const avatarHtml = data.avatar
    ? `<img src="${data.avatar}" alt="${esc(data.name)}">`
    : esc((data.name||'U')[0].toUpperCase());

  // socialLinks удалён — строки всегда рендерятся в renderDefault
  // Теги
  const techTagsHtml = (data.techTags||[]).map(t=>`
    <div class="tech-tag" data-tag="${esc(t)}">
      ${esc(t)}
      <button class="tech-tag-remove" title="Удалить">×</button>
    </div>`).join('');

  // Пресеты тем
  const swatches = THEMES.map(t=>`
    <div class="theme-swatch ${(data.theme||'default')===t.id?'active':''}"
      data-theme="${t.id}" title="${t.label}"
      style="background:linear-gradient(135deg,${t.colors[0]},${t.colors[1]});"></div>
  `).join('');

  return `
  <div class="profile-card fade visible" id="view-default">

    <!-- ═══ БАННЕР ПРОФИЛЯ ═══ -->
    <div class="profile-banner">
      <div class="banner-grid"></div>
      <div class="banner-glow"></div>
      <div class="banner-glow banner-glow-2"></div>
      ${isOwn ? `<button class="banner-edit-btn" id="banner-edit-btn" title="Сменить фон баннера">🎨</button>` : ''}
      <div class="profile-header">
        <div class="profile-avatar-wrap" id="avatar-wrap">
          <div class="profile-avatar" id="profile-avatar-display">${avatarHtml}</div>
          ${isOwn?`<button class="avatar-edit-btn visible" id="avatar-edit-btn" title="Сменить аватар">✏️</button>`:''}
        </div>

        <div class="profile-info">
          <h2 class="profile-name" id="profile-name-display">${esc(data.name||'Без имени')}</h2>
          <input class="profile-name-edit" id="profile-name-edit" type="text" maxlength="32" value="${esc(data.name||'')}" placeholder="Имя">

          <div class="profile-status-row">
            <div class="online-badge">
              <div class="online-dot ${online?'online':''}" id="online-dot"></div>
              <span>${online?'Онлайн':'Оффлайн'}</span>
            </div>
            <span class="custom-status-text" id="status-display">${data.customStatus?esc(data.customStatus):''}</span>
            <input class="custom-status-edit" id="status-edit" maxlength="60"
              placeholder="Кастомный статус..." value="${esc(data.customStatus||'')}">
          </div>

          <span class="profile-role ${roleBadge(data.role)}">${roleLabel(data.role)}</span>
        </div>
      </div>
    </div>

    <!-- Bio -->
    <div class="profile-section">
      <div class="profile-section-label">О себе</div>
      <p class="profile-bio" id="profile-bio-display">${
        data.bio ? esc(data.bio)
                 : '<span style="color:var(--muted);font-style:italic;">Не заполнено</span>'
      }</p>
      <textarea class="profile-bio-edit" id="profile-bio-edit" maxlength="300"
        placeholder="Расскажите о себе (макс. 300 символов)">${esc(data.bio||'')}</textarea>
    </div>

    <!-- Соцссылки — строки всегда видимы -->
    <div class="profile-section">
      <div class="profile-section-label">Контакты</div>
      <div class="social-inputs" id="social-inputs-edit">
        ${SOCIAL_DEFS.map(s => {
          const val = data.social?.[s.key] || '';
          const href = val ? socialHref(s.key, val) : '#';
          const linkHtml = val
            ? `<a class="social-link" href="${href}" target="_blank" rel="noopener" style="padding:5px 12px;font-size:.85rem;">
                <span class="social-icon">${s.icon}</span><span>${esc(val)}</span>
               </a>`
            : `<span style="color:rgba(168,179,204,.4);font-size:.85rem;font-style:italic;">Не указано</span>`;
          return `
          <div class="social-input-row">
            <span class="social-input-label">${s.icon} ${s.label}</span>
            <span class="social-val-display" id="social-display-${s.key}">${linkHtml}</span>
            <input class="social-input-field" id="social-${s.key}" data-social="${s.key}"
              placeholder="${s.placeholder}" value="${esc(val)}" style="display:none;">
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Теги технологий -->
    <div class="profile-section">
      <div class="profile-section-label">Технологии</div>
      <div class="tech-tags" id="tech-tags-display">
        ${techTagsHtml || '<span style="color:var(--muted);font-style:italic;font-size:.85rem;">Не указаны</span>'}
      </div>
      <div class="tech-tag-add-row" id="tech-add-row">
        <input class="tech-tag-input" id="tech-tag-input" placeholder="Добавить тег..." list="tech-suggestions">
        <datalist id="tech-suggestions">
          ${TECH_SUGGESTIONS.map(t=>`<option value="${esc(t)}">`).join('')}
        </datalist>
        <button class="profile-edit-btn visible" id="tech-add-btn" style="padding:6px 14px;font-size:.82rem;">+ Добавить</button>
      </div>
    </div>

    ${isOwn ? `
    <!-- Тема -->
    <div class="profile-section">
      <div class="profile-section-label">Тема профиля</div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <div class="theme-picker" id="theme-picker" style="display:flex;">${swatches}</div>
        <button class="crt-toggle-btn ${document.body.classList.contains('crt-mode')?'on':''}" id="crt-btn">
          📺 CRT-режим
        </button>
      </div>
    </div>` : ''}

    <!-- Мета -->
    ${renderAchievements(data.achievements)}

    <div class="profile-meta">
      <div class="profile-meta-item">📅 <span>Зарегистрирован: ${formatDate(data.createdAt)}</span></div>
      <div class="profile-meta-item" style="font-size:.75rem;opacity:.4;">
        🆔 <span style="font-family:monospace;">${uid}</span>
      </div>
    </div>

    ${!isOwn ? `<a href="messages.html?with=${uid}" class="profile-edit-btn visible" style="text-decoration:none;display:inline-block;">💬 Написать</a>` : ''}
    
    ${isOwn ? `
    <div class="profile-actions">
      <button class="profile-edit-btn visible" id="edit-btn">✏️ Редактировать</button>
      <button class="profile-edit-btn profile-save-btn" id="save-btn">💾 Сохранить</button>
      <button class="profile-edit-btn profile-cancel-btn" id="cancel-btn">Отмена</button>
    </div>
    <p class="profile-error" id="profile-error"></p>
    ` : ''}
  </div>`;
}

// ─── SOCIAL HREF ──────────────────────────────────────────────────────────────

function socialHref(key, value) {
  if (!value) return '#';
  const v = value.replace(/^@/, '');
  if (key==='github')   return `https://github.com/${v}`;
  if (key==='telegram') return `https://t.me/${v}`;
  if (key==='discord')  return '#'; // Discord не имеет публичных ссылок
  return '#';
}

// ─── BIND EDIT HANDLERS ───────────────────────────────────────────────────────

function bindEditHandlers(data, uid) {
  const editBtn  = document.getElementById('edit-btn');
  const saveBtn  = document.getElementById('save-btn');
  const cancelBtn= document.getElementById('cancel-btn');
  const errEl    = document.getElementById('profile-error');
  const avatarBtn= document.getElementById('avatar-edit-btn');
  const fileInput= document.getElementById('avatar-file-input');
  const crtBtn   = document.getElementById('crt-btn');

  let isEditing    = false;
  let pendingAvatar= null;
  let localTags    = [...(data.techTags||[])];

  // ── CRT toggle ──
  crtBtn?.addEventListener('click', ()=>{
    const on = document.body.classList.toggle('crt-mode');
    crtBtn.classList.toggle('on', on);
    localStorage.setItem('crt', on?'1':'0');
  });

  // ── Theme swatches ──
  document.querySelectorAll('.theme-swatch').forEach(sw=>{
    sw.addEventListener('click', ()=>{
      const theme = sw.dataset.theme;
      applyTheme(theme);
      // Сохраняем немедленно (без ожидания Save)
      window.db.collection('users').doc(uid).update({ theme }).catch(console.error);
    });
  });

  // ── Edit mode toggle ──
  function setEditing(val) {
    isEditing = val;

    document.getElementById('profile-name-display').style.display  = val?'none':'';
    document.getElementById('profile-name-edit').style.display     = val?'block':'none';
    document.getElementById('profile-bio-display').style.display   = val?'none':'';
    document.getElementById('profile-bio-edit').style.display      = val?'block':'none';
    document.getElementById('status-display').style.display        = val?'none':'';
    document.getElementById('status-edit').style.display           = val?'inline-block':'none';

    // Соцссылки — переключаем между текстом и полем ввода
    document.getElementById('social-inputs-edit')?.querySelectorAll('.social-val-display').forEach(el=>{
      el.style.display = val ? 'none' : '';
    });
    document.getElementById('social-inputs-edit')?.querySelectorAll('.social-input-field').forEach(f=>{
      f.style.display = val ? 'block' : 'none';
    });

    // Теги
    document.getElementById('tech-add-row')?.style.setProperty('display', val?'flex':'none');
    document.querySelectorAll('.tech-tag-remove').forEach(b=>{ b.style.display = val?'grid':'none'; });

    if (avatarBtn) avatarBtn.style.display = val?'grid':'none';

    const bannerBtn = document.getElementById('banner-edit-btn');
    if (bannerBtn) bannerBtn.style.display = val ? 'grid' : 'none';

    editBtn.style.display  = val?'none':'';
    saveBtn.style.display  = val?'inline-block':'none';
    cancelBtn.style.display= val?'inline-block':'none';

    if (errEl) errEl.textContent='';
  }

  editBtn?.addEventListener('click', ()=> setEditing(true));

  cancelBtn?.addEventListener('click', ()=>{
    pendingAvatar = null;
    localTags = [...(data.techTags||[])];
    // Откат аватара
    const d = document.getElementById('profile-avatar-display');
    if (d) d.innerHTML = data.avatar?`<img src="${data.avatar}" alt="">`:esc((data.name||'U')[0].toUpperCase());
    // Откат тегов
    rebuildTagsUI(localTags, false);
    setEditing(false);
  });

  // ── Save ──
  saveBtn?.addEventListener('click', async ()=>{
    const name   = document.getElementById('profile-name-edit')?.value.trim();
    const bio    = document.getElementById('profile-bio-edit')?.value.trim();
    const status = document.getElementById('status-edit')?.value.trim();
    if (!name){ if(errEl) errEl.textContent='Имя не может быть пустым.'; return; }

    // Соцссылки
    const social = {};
    SOCIAL_DEFS.forEach(s=>{
      const val = document.getElementById(`social-${s.key}`)?.value.trim();
      if (val) social[s.key] = val;
    });

    saveBtn.disabled=true; saveBtn.textContent='Сохраняю...';
    if(errEl) errEl.textContent='';

    try {
      const update = { name, bio:bio||'', customStatus:status||'', social, techTags:localTags };
      if (pendingAvatar) update.avatar = pendingAvatar;

      await window.db.collection('users').doc(uid).update(update);
      // ── Auto-unlock profile achievements ──
      const currentAch = data.achievements || [];
      const newAch = [...currentAch];

      if (bio && !newAch.includes('profile_complete')) newAch.push('profile_complete');
      if (pendingAvatar && !newAch.includes('avatar_set')) newAch.push('avatar_set');
      const hasSocial = Object.values(social).some(v => v && v.trim());
      if (hasSocial && !newAch.includes('social_linked')) newAch.push('social_linked');

      if (newAch.length > currentAch.length) {
        update.achievements = newAch;
        await window.db.collection('users').doc(uid).update({ achievements: newAch });
        // Показываем popup для каждой новой ачивки с задержкой
        const newly = newAch.filter(a => !currentAch.includes(a));
        newly.forEach((key, i) => {
          setTimeout(() => {
            const ach = ALL_ACHIEVEMENTS[key];
            if (ach) {
              // Создаём временный popup если его нет на странице профиля
              let popup = document.getElementById('achievement-popup');
              if (!popup) {
                popup = document.createElement('div');
                popup.id = 'achievement-popup';
                popup.className = 'achievement-popup';
                popup.innerHTML = '<div class="achievement-icon"></div><div class="achievement-title"></div><div class="achievement-desc"></div>';
                // Добавляем стили если их нет
                if (!document.getElementById('ach-popup-style')) {
                  const style = document.createElement('style');
                  style.id = 'ach-popup-style';
                  style.textContent = `
                    .achievement-popup {
                      position:fixed; top:32px; right:32px;
                      background:rgba(10,16,30,.98);
                      border:1px solid rgba(139,123,255,.4);
                      border-radius:12px; padding:16px 20px;
                      font-family:'JetBrains Mono',monospace;
                      box-shadow:0 20px 50px rgba(0,0,0,.7), 0 0 30px rgba(139,123,255,.2);
                      transform:translateX(400px);
                      transition:transform .5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
                      z-index:10000; max-width:320px;
                    }
                    .achievement-popup.show { transform:translateX(0); }
                    .achievement-icon { font-size:1.5rem; margin-bottom:8px; }
                    .achievement-title { color:rgba(139,123,255,.9); font-size:.85rem; font-weight:600; margin-bottom:4px; }
                    .achievement-desc { color:rgba(168,179,204,.6); font-size:.72rem; line-height:1.4; }
                    @media(max-width:540px){ .achievement-popup{right:16px;max-width:calc(100vw - 32px);} }
                  `;
                  document.head.appendChild(style);
                }
                document.body.appendChild(popup);
              }
              popup.querySelector('.achievement-icon').textContent = ach.icon;
              popup.querySelector('.achievement-title').textContent = ach.title;
              popup.querySelector('.achievement-desc').textContent = ach.desc;
              popup.classList.add('show');
              setTimeout(() => popup.classList.remove('show'), 4000);
            }
          }, i * 1500);
        });
      }
      if (window.auth.currentUser) await window.auth.currentUser.updateProfile({ displayName:name });

      Object.assign(data, update);
      renderProfile(data, uid, true);
    } catch(err){
      console.error('❌ Сохранение:', err);
      if(errEl) errEl.textContent='Ошибка: '+err.message;
      saveBtn.disabled=false; saveBtn.textContent='💾 Сохранить';
    }
  });

  // ── Avatar ──
  avatarBtn?.addEventListener('click', ()=> fileInput?.click());
  fileInput?.addEventListener('change', async e=>{
    const file=e.target.files?.[0];
    if(!file) return;
    if(file.size>5*1024*1024){ if(errEl) errEl.textContent='Файл слишком большой (макс. 5 МБ).'; return; }
    try {
      const b64 = await resizeToBase64(file, 162);
      pendingAvatar=b64;
      const d=document.getElementById('profile-avatar-display');
      if(d) d.innerHTML=`<img src="${b64}" alt="avatar">`;
    } catch(err){ if(errEl) errEl.textContent='Ошибка обработки изображения.'; }
    fileInput.value='';
  });

  // ── Tech tags ──
  function rebuildTagsUI(tags, editing) {
    const container = document.getElementById('tech-tags-display');
    if (!container) return;
    if (tags.length===0) {
      container.innerHTML='<span style="color:var(--muted);font-style:italic;font-size:.85rem;">Не указаны</span>';
      return;
    }
    container.innerHTML = tags.map(t=>`
      <div class="tech-tag" data-tag="${esc(t)}">
        ${esc(t)}
        <button class="tech-tag-remove" style="display:${editing?'grid':'none'};" title="Удалить">×</button>
      </div>`).join('');
    container.querySelectorAll('.tech-tag-remove').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const tag=btn.closest('.tech-tag').dataset.tag;
        localTags=localTags.filter(t=>t!==tag);
        rebuildTagsUI(localTags, true);
      });
    });
  }

  document.getElementById('tech-add-btn')?.addEventListener('click', ()=>{
    const input=document.getElementById('tech-tag-input');
    const val=input?.value.trim();
    if(!val||localTags.includes(val)||localTags.length>=20) return;
    localTags.push(val);
    rebuildTagsUI(localTags, true);
    input.value='';
  });
  document.getElementById('tech-tag-input')?.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('tech-add-btn')?.click(); }
  });

  // Частицы на аватар
  const wrap=document.getElementById('avatar-wrap');
  if(wrap) spawnParticles(wrap);

  setEditing(false);
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderProfile(data, uid, isOwn) {
  const root=document.getElementById('profile-root');
  if(!root) return;

  document.title=`${data.name||'Профиль'} — EgorNetwork`;
  applyTheme(data.theme||'default');

  // Восстановить CRT из localStorage (только для своего профиля)
  if (isOwn && localStorage.getItem('crt')==='1') {
    document.body.classList.add('crt-mode');
  }

  root.innerHTML =
    renderDefault(data, uid, isOwn) +
    renderTerminal(data, uid) +
    renderWin95(data, uid);

  initViewSwitcher(data, uid, isOwn);

  if (isOwn) bindEditHandlers(data, uid);
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────

async function loadProfile(uid, currentUser) {
  try {
    const doc=await window.db.collection('users').doc(uid).get();
    if(!doc.exists){
      const root=document.getElementById('profile-root');
      if(root) root.innerHTML=`<div class="profile-not-found"><h3>👤 Профиль не найден</h3><p>Пользователь не существует или ещё не заходил на сайт.</p></div>`;
      return;
    }
    const data=doc.data();
    const isOwn=currentUser&&currentUser.uid===uid;
    renderProfile(data, uid, isOwn);

    // Запускаем пинг для своего профиля
    if (isOwn) startPresenceHeartbeat(uid);
  } catch(err){
    console.error('❌ Загрузка:', err);
    showError('Не удалось загрузить профиль: '+err.message);
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

function init() {
  const params=new URLSearchParams(window.location.search);
  let targetUid=params.get('uid');

  waitForFirebase(()=>{
    window.auth.onAuthStateChanged(async currentUser=>{
      if(!targetUid){
        if(!currentUser){ showError('Войдите в аккаунт, чтобы просмотреть профиль.'); return; }
        targetUid=currentUser.uid;
        history.replaceState(null,'',`?uid=${currentUser.uid}`);
      }
      await loadProfile(targetUid, currentUser);
    });
  });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', init);
} else { init(); }
