/**
 * 👤 Profile System v2 — EgorNetwork
 *
 * Firestore: users/{uid}
 *   name, bio, avatar (base64 96x96), role, createdAt,
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

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 минуты

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

function resizeToBase64(file, size=96) { 
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

// ─── ONLINE PRESENCE ──────────────────────────────────────────────────────────

let presenceInterval = null;

function startPresenceHeartbeat(uid) {
  const update = () => {
    window.db.collection('users').doc(uid).update({
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(()=>{});
  };
  update();
  presenceInterval = setInterval(update, 60000);
  window.addEventListener('beforeunload', ()=> clearInterval(presenceInterval));
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
    .join(' ');

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
    </div>
  </div>`;
}

// ─── RENDER: DEFAULT ──────────────────────────────────────────────────────────

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

    <div class="profile-header">
      <div class="profile-avatar-wrap" id="avatar-wrap">
        <div class="profile-avatar" id="profile-avatar-display">${avatarHtml}</div>
        ${isOwn?`<button class="avatar-edit-btn visible" id="avatar-edit-btn" title="Сменить аватар">✏️</button>`:''}
        ${!isOwn ? `<a href="messages.html?with=${uid}" class="profile-edit-btn visible" style="text-decoration:none;display:inline-block;">💬 Написать</a>` : ''}
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
    <div class="profile-meta">
      <div class="profile-meta-item">📅 <span>Зарегистрирован: ${formatDate(data.createdAt)}</span></div>
      <div class="profile-meta-item" style="font-size:.75rem;opacity:.4;">
        🆔 <span style="font-family:monospace;">${uid}</span>
      </div>
    </div>

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
      const b64 = await resizeToBase64(file, 96);
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