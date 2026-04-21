/**
 * 🎨 Optimized Main Script for EgorNetwork
 * Модульная структура + производительность + читаемость
 */

'use strict';

// ============================================================================
// 🧰 UTILITIES
// ============================================================================

/**
 * Кэшированный доступ к DOM-элементам
 */
const DOM = {
  cache: {},
  get(selector, key = selector) {
    if (!this.cache[key]) {
      this.cache[key] = document.querySelector(selector);
    }
    return this.cache[key];
  },
  getAll(selector) {
    return document.querySelectorAll(selector);
  },
  clear() {
    this.cache = {};
  }
};

/**
 * Плавный аниматор на основе requestAnimationFrame
 * @param {Object} state - текущие значения
 * @param {Object} target - целевые значения
 * @param {Function} onUpdate - коллбэк при обновлении
 * @param {Object} options - настройки
 */
function createAnimator(state, target, onUpdate, options = {}) {
  const { easing = 0.1, epsilon = 0.02, onStep } = options;
  let rafId = null;
  let isRunning = false;

  const step = () => {
    let settled = true;
    
    for (const key in target) {
      const diff = target[key] - state[key];
      if (Math.abs(diff) > epsilon) settled = false;
      state[key] += diff * easing;
    }
    
    onUpdate(state, target);
    if (onStep) onStep(state, target);
    
    if (!settled) {
      rafId = requestAnimationFrame(step);
    } else {
      rafId = null;
      isRunning = false;
    }
  };

  return {
    update(newTarget) {
      Object.assign(target, newTarget);
      if (!isRunning) {
        isRunning = true;
        rafId = requestAnimationFrame(step);
      }
    },
    set(values) {
      Object.assign(state, values);
      Object.assign(target, values);
      onUpdate(state, target);
    },
    cancel() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      isRunning = false;
    },
    isRunning: () => isRunning
  };
}

/**
 * Throttle-функция для ограничения частоты вызовов
 */
function throttle(fn, delay) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

/**
 * Проверка предпочтений пользователя
 */
const Preferences = {
  get reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
  get finePointer() {
    return window.matchMedia('(pointer: fine)').matches;
  }
};

// ============================================================================
// 🎨 VISUAL EFFECTS
// ============================================================================

function createBackgroundEffects() {
  // Создаём элементы только если их нет
  if (!document.querySelector('.bg-waves')) {
    const waves = document.createElement('div');
    waves.className = 'bg-waves';
    document.body.appendChild(waves);
  }

  if (!document.querySelector('.bg-fog')) {
    const fog = document.createElement('div');
    fog.className = 'bg-fog';
    for (let i = 0; i < 5; i++) fog.appendChild(document.createElement('span'));
    document.body.appendChild(fog);
  }

  if (!document.querySelector('.bg-aurora')) {
    const aurora = document.createElement('div');
    aurora.className = 'bg-aurora';
    document.body.appendChild(aurora);
  }
}

// ============================================================================
// 📊 SCROLL PROGRESS
// ============================================================================

function initScrollProgress() {
  let progressBar = DOM.get('.scroll-progress');
  
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.className = 'scroll-progress';
    progressBar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#6366f1,#a855f7);transform-origin:left;will-change:transform;z-index:9999;';
    document.body.appendChild(progressBar);
    DOM.cache['.scroll-progress'] = progressBar;
  }

  const updateProgress = () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const progress = maxScroll <= 0 ? 1 : Math.min(1, window.scrollY / maxScroll);
    progressBar.style.transform = `scaleX(${progress})`;
  };

  // Используем passive: true для улучшения производительности скролла
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', throttle(updateProgress, 100));
  updateProgress();
}

// ============================================================================
// ✨ CURSOR GLOW
// ============================================================================

function initCursorGlow() {
  if (!Preferences.finePointer || Preferences.reducedMotion) {
    document.documentElement.style.setProperty('--cursor-x', '50%');
    document.documentElement.style.setProperty('--cursor-y', '50%');
    return;
  }

  // Throttle mousemove для снижения нагрузки
  const onMove = throttle((e) => {
    document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`);
  }, 16); // ~60fps

  window.addEventListener('mousemove', onMove, { passive: true });
}

// ============================================================================
// 🃏 CARD TILT EFFECT — ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================================================

function initCardTilt() {
  if (Preferences.reducedMotion || !Preferences.finePointer) return;

  const cards = DOM.getAll('.card, .gallery-item');
  
  cards.forEach((card) => {
    if (card.dataset.tiltReady === '1') return;
    card.dataset.tiltReady = '1';
    
    // Инициализация состояния
    card._tiltState = {
      state: { rx: 0, ry: 0, mx: 50, my: 50, raise: 0 },
      target: { rx: 0, ry: 0, mx: 50, my: 50, raise: 0 },
      config: getCardConfig(card.classList.contains('gallery-item')),
      rect: null,
      rectTime: 0,
      animator: null
    };

    // ⚠️ ВАЖНО: pointerenter/leave вешаем НАПРЯМУЮ на карточку
    // Делегирование здесь ломает логику выхода за границы
    card.addEventListener('pointerenter', (e) => onCardEnter(card, e), { passive: true });
    card.addEventListener('pointerleave', (e) => onCardLeave(card, e), { passive: true });
    card.addEventListener('pointermove', (e) => onCardMove(card, e), { passive: true });
    card.addEventListener('pointercancel', () => onCardLeave(card), { passive: true });
  });

  // pointermove можно оставить делегированным для экономии памяти (опционально)
  // Но для надёжности лучше на каждую карточку — их обычно не сотни
}

function onCardEnter(card, e) {
  const data = card._tiltState;
  if (!data) return;
  
  // Сбрасываем кэш rect при новом входе
  data.rect = null;
  
  // Инициализируем аниматор при входе, а не при движении!
  if (!data.animator) {
    data.animator = createAnimator(
      data.state,
      data.target,
      (state) => applyCardStyles(card, state, data.config),
      { easing: data.config.easing }
    );
  }
  
  // Сразу ставим целевое значение поднятия
  data.target.raise = data.config.hoverRaise;
  data.animator.update({ ...data.target });
}

function onCardMove(card, e) {
  const data = card._tiltState;
  if (!data || !data.animator) return;
  
  // Кэшируем rect с троттлингом по времени (не чаще 100мс)
  const now = Date.now();
  if (!data.rect || now - data.rectTime > 100) {
    data.rect = card.getBoundingClientRect();
    data.rectTime = now;
  }

  const { rect, target, config } = data;
  const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

  target.rx = (0.5 - py) * config.tiltMax;
  target.ry = (px - 0.5) * config.tiltMax;
  target.mx = px * 100;
  target.my = py * 100;
  // raise уже установлен в onCardEnter, но можно обновить если нужно
  
  data.animator.update({ ...target });
}

function onCardLeave(card) {
  const data = card._tiltState;
  if (!data) return;
  
  // Сбрасываем все значения в исходное состояние
  Object.assign(data.target, { 
    rx: 0, 
    ry: 0, 
    mx: 50, 
    my: 50, 
    raise: 0 
  });
  
  // Если аниматор ещё не создан — создаём его для плавного сброса
  if (!data.animator) {
    data.animator = createAnimator(
      data.state,
      data.target,
      (state) => applyCardStyles(card, state, data.config),
      { easing: data.config.easing }
    );
  }
  
  data.animator.update({ ...data.target });
}

// Остальные вспомогательные функции без изменений:
function getCardConfig(isGallery) {
  return {
    tiltMax: isGallery ? 8 : 12,
    hoverRaise: isGallery ? -3.0 : -4.8,
    easing: isGallery ? 0.09 : 0.12,
    shadowMul: isGallery ? 1.1 : 1.4,
    shadowBaseY: isGallery ? 12 : 16,
    shadowBlur: isGallery ? 28 : 34
  };
}

function applyCardStyles(card, state, config) {
  card.style.setProperty('--rx', `${state.rx.toFixed(2)}deg`);
  card.style.setProperty('--ry', `${state.ry.toFixed(2)}deg`);
  card.style.setProperty('--mx', `${state.mx.toFixed(2)}%`);
  card.style.setProperty('--my', `${state.my.toFixed(2)}%`);
  card.style.setProperty('--raise', `${state.raise.toFixed(2)}px`);
  
  const shadowX = (-state.ry * config.shadowMul).toFixed(2);
  const shadowY = (config.shadowBaseY + state.rx * (config.shadowMul * 0.8)).toFixed(2);
  card.style.setProperty('--depth-shadow', `${shadowX}px ${shadowY}px ${config.shadowBlur}px rgba(0,0,0,.26)`);
}

// ============================================================================
// 🦸 HERO DEPTH EFFECT
// ============================================================================

function initHeroDepth() {
  const hero = DOM.get('#hero');
  if (!hero) return;

  if (Preferences.reducedMotion || !Preferences.finePointer) {
    setHeroVars(hero, 0, 0, 0, 0);
    return;
  }

  const state = { rx: 0, ry: 0, shiftX: 0, shiftY: 0 };
  const target = { rx: 0, ry: 0, shiftX: 0, shiftY: 0 };
  let rect = null;

  const animator = createAnimator(
    state,
    target,
    (s) => setHeroVars(hero, s.rx, s.ry, s.shiftX, s.shiftY),
    { easing: 0.1 }
  );

  const onMove = (e) => {
    if (!rect || rect.width !== hero.offsetWidth) {
      rect = hero.getBoundingClientRect();
    }
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    target.rx = (0.5 - py) * 7;
    target.ry = (px - 0.5) * 9;
    target.shiftX = (px - 0.5) * 18;
    target.shiftY = (py - 0.5) * 12;
    animator.update({ ...target });
  };

  const reset = () => {
    animator.update({ rx: 0, ry: 0, shiftX: 0, shiftY: 0 });
  };

  hero.addEventListener('pointermove', onMove, { passive: true });
  hero.addEventListener('pointerleave', reset, { passive: true });
}

function setHeroVars(hero, rx, ry, shiftX, shiftY) {
  hero.style.setProperty('--hero-rx', `${rx.toFixed(2)}deg`);
  hero.style.setProperty('--hero-ry', `${ry.toFixed(2)}deg`);
  hero.style.setProperty('--hero-shift-x', `${shiftX.toFixed(2)}px`);
  hero.style.setProperty('--hero-shift-y', `${shiftY.toFixed(2)}px`);
}

// ============================================================================
// 🧭 NAVIGATION
// ============================================================================

function initNav() {
  initMobileMenu();
  initNavHighlight();
}

function initMobileMenu() {
  const burger = DOM.get('.burger');
  const mobile = DOM.get('.mobile-menu');
  
  if (!burger || !mobile || burger.dataset.menuReady === '1') return;
  burger.dataset.menuReady = '1';

  const toggleMenu = () => {
    const isOpen = mobile.classList.toggle('is-open');
    burger.classList.toggle('is-open', isOpen);
    burger.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('menu-open', isOpen);
  };

  const closeMenu = () => {
    mobile.classList.remove('is-open');
    burger.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('menu-open');
  };

  burger.addEventListener('click', toggleMenu);
  
  // Закрытие по клику на ссылку
  mobile.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') closeMenu();
  }, { passive: true });

  // Закрытие по клику вне меню (только на мобильных)
  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;
    if (!mobile.classList.contains('is-open')) return;
    if (burger.contains(e.target) || mobile.contains(e.target)) return;
    closeMenu();
  }, { passive: true });

  // Закрытие при ресайзе на десктоп
  window.addEventListener('resize', throttle(() => {
    if (window.innerWidth > 768) closeMenu();
  }, 150));
}

function initNavHighlight() {
  const highlight = DOM.get('.nav-highlight');
  const nav = DOM.get('.nav');
  // Выбираем все ссылки и кнопку "Ещё" внутри навигации
  const navItems = DOM.getAll('.nav a, .nav .nav-dropdown-toggle');
  
  if (!highlight || !nav || navItems.length === 0) return;

  // Подсветка активной ссылки (если URL совпадает)
  const currentURL = window.location.href;
  navItems.forEach(item => {
    const href = item.getAttribute('href');
    if (href && currentURL.includes(href)) {
      item.classList.add('active');
    }
  });

  // Функция для получения актуальных координат nav (на случай ресайза)
  const getNavRect = () => nav.getBoundingClientRect();

  const onEnter = (e) => {
    const item = e.currentTarget;
    const itemRect = item.getBoundingClientRect();
    const navRect = getNavRect();
    
    // Устанавливаем размеры и позицию подсветки относительно nav
    highlight.style.width = `${itemRect.width}px`;
    highlight.style.height = `${itemRect.height}px`;
    highlight.style.transform = `translate(${itemRect.left - navRect.left}px, ${itemRect.top - navRect.top}px)`;
    highlight.style.opacity = '1';
  };

  // Навешиваем обработчики на все элементы навигации
  navItems.forEach(item => {
    item.addEventListener('mouseenter', onEnter, { passive: true });
  });
  
  // При уходе курсора с навигации — прячем подсветку
  nav.addEventListener('mouseleave', () => {
    highlight.style.opacity = '0';
  }, { passive: true });
}

// ============================================================================
// 🧠 SMART HEADER (показ/скрытие при скролле)
// ============================================================================

function initSmartHeader() {
  const header = DOM.get('.header');
  if (!header) return;

  let lastScrollY = window.scrollY;
  let ticking = false;

  const updateHeader = () => {
    const currentY = window.scrollY;
    
    if (currentY > lastScrollY && currentY > 100) {
      header.classList.add('header-hidden');
    } else {
      header.classList.remove('header-hidden');
    }
    lastScrollY = currentY;
    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }, { passive: true });
}

// ============================================================================
// 🌀 SMOOTH SCROLL (оптимизированный)
// ============================================================================

function initSmoothScroll() {
  if (Preferences.reducedMotion) return;

  const config = {
    lerp: 0.14,
    epsilon: 0.35,
    keyStep: 100,
    scrollbarZone: 20
  };

  let current = window.scrollY;
  let target = current;
  let rafId = null;
  let isDragging = false;

  const getMaxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const clamp = (val) => Math.max(0, Math.min(val, getMaxScroll()));

  const step = () => {
    const delta = target - current;
    
    if (Math.abs(delta) <= config.epsilon) {
      current = target;
      window.scrollTo(0, current);
      rafId = null;
      return;
    }
    
    current += delta * config.lerp;
    window.scrollTo(0, current);
    rafId = requestAnimationFrame(step);
  };

  const start = () => { if (rafId === null) rafId = requestAnimationFrame(step); };
  const stop = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    current = window.scrollY;
    target = current;
  };

  // Wheel с проверкой на зум и тачпады
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return;
    
    e.preventDefault();
    isDragging = false;
    target = clamp(target + e.deltaY);
    start();
  }, { passive: false });

  // Нативный скролл для восстановления позиции
  window.addEventListener('scroll', () => {
    if (rafId === null && !isDragging) {
      current = window.scrollY;
      target = current;
    }
  }, { passive: true });

  // Обработка перетаскивания скроллбара
  window.addEventListener('mousedown', (e) => {
    if (e.clientX >= window.innerWidth - config.scrollbarZone) {
      isDragging = true;
      stop();
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      current = window.scrollY;
      target = current;
    }
  });

  // Клавиатура
  window.addEventListener('keydown', (e) => {
    let delta = 0;
    
    switch(e.key) {
      case 'Home': e.preventDefault(); target = 0; break;
      case 'End': e.preventDefault(); target = getMaxScroll(); break;
      case 'ArrowDown': delta = config.keyStep; break;
      case 'ArrowUp': delta = -config.keyStep; break;
      case 'PageDown': delta = window.innerHeight * 0.9; break;
      case 'PageUp': delta = -window.innerHeight * 0.9; break;
      default: return;
    }
    
    if (delta !== 0) {
      e.preventDefault();
      target = clamp(target + delta);
      start();
    }
  });

  // Ресайз
  window.addEventListener('resize', throttle(() => {
    target = clamp(target);
    current = clamp(current);
  }, 100));
}

// ============================================================================
// 📋 COPY BUTTON
// ============================================================================

function initCopyButtons() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;

    const code = btn.closest('.code-block')?.querySelector('code');
    if (!code) return;

    navigator.clipboard.writeText(code.textContent).then(() => {
      const original = btn.textContent;
      btn.textContent = 'Скопировано!';
      btn.classList.add('copied');
      
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 2000);
    }).catch(err => {
      console.error('Ошибка копирования:', err);
    });
  });
}

// ============================================================================
// ✨ PARTICLES (Dust & Bugs)
// ============================================================================

function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function initParticles(containerSelector, randomizeFn) {
  const container = DOM.get(containerSelector);
  if (!container) return;

  // Добавляем contain для оптимизации рендеринга
  container.style.contain = 'layout style paint';
  container.style.pointerEvents = 'none';

  container.querySelectorAll('span').forEach((span) => {
    if (span.dataset.ready === '1') return;
    span.dataset.ready = '1';
    
    randomizeFn(span, true); // initial with negative delay
    
    span.addEventListener('animationiteration', () => {
      randomizeFn(span, false);
    });
  });
}

function randomizeDust(span, useNegativeDelay = false) {
  const duration = randomRange(11, 19);
  const delay = useNegativeDelay ? -Math.random() * duration : 0;
  
  span.style.cssText = `
    left: ${randomRange(0, 100).toFixed(2)}%;
    top: ${randomRange(0, 100).toFixed(2)}%;
    --dx: ${randomRange(-90, 90).toFixed(2)}px;
    --dy: ${(-window.innerHeight * randomRange(0.35, 1.2)).toFixed(2)}px;
    --dust-size: ${randomRange(1, 3).toFixed(2)}px;
    --dust-opacity: ${randomRange(0.25, 0.75).toFixed(2)};
    animation-duration: ${duration.toFixed(2)}s;
    animation-delay: ${delay.toFixed(2)}s;
  `;
}

function randomizeBug(span, useNegativeDelay = false) {
  const duration = randomRange(24, 38);
  const delay = useNegativeDelay ? -Math.random() * duration : randomRange(0, 8);
  const size = randomRange(1.8, 3.4);
  const glow = randomRange(0.18, 0.42);
  
  span.style.cssText = `
    left: ${randomRange(2, 98).toFixed(2)}%;
    width: ${size.toFixed(2)}px;
    height: ${size.toFixed(2)}px;
    animation-duration: ${duration.toFixed(2)}s;
    animation-delay: ${delay.toFixed(2)}s;
    box-shadow: 0 0 ${Math.max(2, size * 1.6).toFixed(2)}px rgba(100, 255, 100, ${glow.toFixed(2)});
  `;
}

function createDust() {
  initParticles('.dust', randomizeDust);
}

function createBugs() {
  initParticles('.bugs', randomizeBug);
}

// ============================================================================
// 🔄 COMPONENT LOADER
// ============================================================================

async function loadComponent(id, file) {
  try {
    const response = await fetch(file, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const html = await response.text();
    const container = document.getElementById(id);
    if (!container) return;

    container.innerHTML = html;

    if (id === 'header-container') {
      DOM.clear();
      initNav();
      initSmartHeader();
      loadAuthModal(); // Загружаем модальное окно авторизации
    }
    if (id === 'footer-container') {
      createBugs();
    }
  } catch (e) {
    console.error(`❌ Ошибка загрузки ${file}:`, e);
  }
}

// ============================================================================
// 👑 ROLE MANAGER (Система ролей)
// ============================================================================

const RoleManager = {
  currentRole: 'guest',
  // Иерархия прав (число определяет уровень доступа)
  hierarchy: { admin: 4, moderator: 3, user: 2, guest: 1 },

  // Инициализация роли пользователя
  async init(user) {
    if (!user) {
      this.currentRole = 'guest';
      this.applyUI();
      return;
    }

    // Если Firestore еще не готов, ждем
    if (!window.firebase || !window.firebase.firestore) {
      console.warn('⏳ Firestore еще загружается...');
      await new Promise(r => setTimeout(r, 500));
    }

    try {
      const db = window.firebase.firestore();
      const docRef = db.collection('users').doc(user.uid);
      const doc = await docRef.get();

      if (doc.exists) {
        this.currentRole = doc.data().role || 'user';
      } else {
        // Новый пользователь — роль User
        await docRef.set({
          email: user.email,
          name: user.displayName || 'User',
          role: 'user',
          createdAt: new Date()
        });
        this.currentRole = 'user';
      }
      
      console.log(`👤 Роль пользователя: ${this.currentRole}`);
      this.applyUI();
    } catch (e) {
      console.error('❌ Ошибка загрузки роли:', e);
      this.currentRole = 'user'; // Фолбек
      this.applyUI();
    }
  },

  // Управляет видимостью элементов по классам
  applyUI() {
    const level = this.hierarchy[this.currentRole] || 0;

    // Скрываем все элементы с классами ролей перед перерисовкой
    document.querySelectorAll('.role-admin, .role-mod, .role-user, .role-guest-msg').forEach(el => {
      el.style.display = 'none';
    });

    // Показываем элементы в зависимости от уровня доступа
    // Админ (4): Видит всё
    if (level >= 4) document.querySelectorAll('.role-admin').forEach(el => el.style.display = '');
    
    // Модер (3): Видит инструменты модерации + контент юзера
    if (level >= 3) document.querySelectorAll('.role-mod').forEach(el => el.style.display = '');
    
    // Юзер (2): Видит контент для юзеров (комменты и т.д.)
    if (level >= 2) document.querySelectorAll('.role-user').forEach(el => el.style.display = '');

    // Гость (1): Видит сообщение "Войдите"
    if (level < 2) {
      document.querySelectorAll('.role-guest-msg').forEach(el => el.style.display = 'block');
    }
  },

  // Проверка прав в JS коде
  can(action) {
    const roles = {
      publish: 'admin',
      deleteComment: 'moderator',
      comment: 'user'
    };
    return (this.hierarchy[this.currentRole] || 0) >= (this.hierarchy[roles[action]] || 0);
  }
};

// ============================================================================
// 🔐 AUTHORIZATION
// ============================================================================

let firebaseReady = false;

// Функция загрузки скриптов Firebase (если их нет в HTML)
async function ensureFirebase() {
  if (window.firebase) return; // Уже загружен
  
  console.log('⏳ Загрузка Firebase SDK...');
  
  // Список скриптов для загрузки
  const scripts = [
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js' // Добавлен Firestore
  ];

  // Загружаем последовательно
  for (const src of scripts) {
    if (!document.querySelector(`script[src="${src}"]`)) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
  }
  
  // Инициализируем конфиг
  try {
    await loadScript('components/firebase-config.js');
    firebaseReady = true;
    console.log('✅ Firebase SDK готов');
  } catch (e) {
    console.error('❌ Ошибка инициализации Firebase:', e);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Загрузка модального окна авторизации
async function loadAuthModal() {
  try {
    // 1. Убеждаемся, что Firebase загружен
    await ensureFirebase();
    
    if (!window.auth) {
      console.error('❌ Firebase Auth не инициализирован');
      return;
    }

    // 2. Загружаем HTML модалки
    const response = await fetch('components/auth.html');
    if (!response.ok) throw new Error('Файл auth.html не найден');
    
    const html = await response.text();
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    
    console.log('✅ Auth UI загружен');

    // 3. Инициализируем логику
    initAuth();
  } catch (e) {
    console.error('❌ Ошибка настройки авторизации:', e);
  }
}

// Инициализация авторизации (обновленная версия)
function initAuth() {
  console.log('🛡️ Настройка кнопок авторизации...');
  
  // Обработка результата редиректа (для Google SignIn)
  window.auth.getRedirectResult().then((result) => {
    if (result.user) {
      console.log('✅ Вход через Google успешен');
    }
  }).catch((error) => {
    console.error('❌ Ошибка редиректа:', error);
  });
  
  // Элементы
  const authBtn = document.getElementById('auth-btn');
  const authLogout = document.getElementById('auth-logout');
  const mobileAuthBtn = document.getElementById('mobile-auth-btn');
  const mobileAuthLogout = document.getElementById('mobile-auth-logout');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-name');
  const authModal = document.getElementById('auth-modal');
  const authClose = document.getElementById('auth-close');
  const authBackdrop = document.getElementById('auth-backdrop');
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const showRegister = document.getElementById('show-register');
  const showLogin = document.getElementById('show-login');
  const loginSubmit = document.getElementById('login-submit');
  const registerSubmit = document.getElementById('register-submit');
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');
  
  // Кнопка Google
  const googleBtn = document.getElementById('google-btn');

  if (!window.auth) return;

  // =========================================
  // 📡 СЛУШАТЕЛЬ СОСТОЯНИЯ АВТОРИЗАЦИИ
  // =========================================
  let authProcessing = false;
  let lastAuthState = null;

  window.auth.onAuthStateChanged(async (user) => {
    // Дедупликация: не обрабатываем одинаковые состояния подряд
    const currentState = user ? user.uid : null;
    if (currentState === lastAuthState) return;
    lastAuthState = currentState;

    console.log('📡 onAuthStateChanged:', user ? `Вошёл: ${user.displayName || user.email}` : 'Не вошёл');

    if (authProcessing) {
      console.log('⏳ Предыдущий вызов ещё не завершился, пропускаем');
      return;
    }

    if (user) {
      authProcessing = true;
      try {
        showUser(user.displayName || user.email);
        await RoleManager.init(user);
        const msgLink = document.getElementById('msg-link');
        if (msgLink) msgLink.style.display = 'inline-block';
        const profileLink = document.getElementById('profile-link');
        if (profileLink && window.auth?.currentUser) {
          profileLink.href = `profile.html?uid=${window.auth.currentUser.uid}`;
        }
        
      } finally {
        authProcessing = false;
      }
    } else {
      hideUser();
      RoleManager.init(null);
    }
  });

  // Открытие модалки
  function openModal() {
    if (authModal) authModal.classList.add('is-open');
  }
  if (authBtn) authBtn.addEventListener('click', openModal);
  if (mobileAuthBtn) mobileAuthBtn.addEventListener('click', () => {
    openModal();
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) mobileMenu.classList.remove('is-open');
  });

  // Закрытие модалки
  function closeModal() {
    if (authModal) authModal.classList.remove('is-open');
    loginError.textContent = '';
    registerError.textContent = '';
  }
  if (authClose) authClose.addEventListener('click', closeModal);
  if (authBackdrop) authBackdrop.addEventListener('click', closeModal);

  // Переключение форм
  if (showRegister) showRegister.onclick = (e) => { e.preventDefault(); loginForm.style.display='none'; registerForm.style.display='block'; };
  if (showLogin) showLogin.onclick = (e) => { e.preventDefault(); registerForm.style.display='none'; loginForm.style.display='block'; };

  // ВХОД
  if (loginSubmit) {
    loginSubmit.onclick = async () => {
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      if (!email || !password) { loginError.textContent = 'Заполните все поля'; return; }
      try {
        await window.auth.signInWithEmailAndPassword(email, password);
        closeModal();
      } catch (e) { loginError.textContent = e.message; console.error(e); }
    };
  }

  // РЕГИСТРАЦИЯ
  if (registerSubmit) {
    registerSubmit.onclick = async () => {
      const name = document.getElementById('register-name').value.trim();
      const email = document.getElementById('register-email').value.trim();
      const password = document.getElementById('register-password').value;
      if (!name || !email || !password) { registerError.textContent = 'Заполните все поля'; return; }
      try {
        const cred = await window.auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: name });
        closeModal();
      } catch (e) { registerError.textContent = e.message; console.error(e); }
    };
  }

  // GOOGLE ВХОД (Popup — работает на локалхосте без спец. настроек сервера)
  if (googleBtn) {
    googleBtn.onclick = async () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      try {
        console.log('🔄 Google Auth: Открываем окно...');
        const result = await window.auth.signInWithPopup(provider);
        console.log('✅ Успешный вход:', result.user.displayName);
        closeModal();
      } catch (e) {
        console.error("Google Auth Error:", e);
        if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
           loginError.textContent = "Ошибка Google входа: " + e.message;
        }
      }
    };
  }

  // ВЫХОД
  function logout() { window.auth.signOut(); }
  if (authLogout) authLogout.onclick = logout;
  if (mobileAuthLogout) mobileAuthLogout.onclick = logout;

  // Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModal && authModal.classList.contains('is-open')) closeModal();
  });
}

// Показать пользователя
function showUser(name) {
  // Desktop
  const authBtn = document.getElementById('auth-btn');
  const userMenu = document.getElementById('user-menu');
  const userName = document.getElementById('user-name');
  if (authBtn) authBtn.style.display = 'none';
  if (userMenu) userMenu.style.display = 'flex';
  if (userName) userName.textContent = name;

  // Mobile
  const mobileAuthBtn = document.getElementById('mobile-auth-btn');
  const mobileUserMenu = document.getElementById('mobile-user-menu');
  const mobileUserName = document.getElementById('mobile-user-name');
  if (mobileAuthBtn) mobileAuthBtn.style.display = 'none';
  if (mobileUserMenu) mobileUserMenu.style.display = 'flex';
  if (mobileUserName) mobileUserName.textContent = name;
}

// Скрыть пользователя
function hideUser() {
  // Desktop
  const authBtn = document.getElementById('auth-btn');
  const userMenu = document.getElementById('user-menu');
  if (authBtn) authBtn.style.display = 'block';
  if (userMenu) userMenu.style.display = 'none';

  // Mobile
  const mobileAuthBtn = document.getElementById('mobile-auth-btn');
  const mobileUserMenu = document.getElementById('mobile-user-menu');
  if (mobileAuthBtn) mobileAuthBtn.style.display = 'block';
  if (mobileUserMenu) mobileUserMenu.style.display = 'none';
}

// ============================================================================
// 👁️ FADE-IN ANIMATION (Intersection Observer)
// ============================================================================

function initFadeIn() {
  const elements = DOM.getAll('.fade');
  if (elements.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // отписываемся после показа
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

  elements.forEach(el => observer.observe(el));
}

// ============================================================================
// 🚀 INITIALIZATION
// ============================================================================

function init() {
  // Предварительная инициализация
  createBackgroundEffects();
  
  // Эффекты, не зависящие от контента
  initScrollProgress();
  initCursorGlow();
  initFadeIn();
  initCopyButtons();
  
  // Загрузка компонентов
  loadComponent('header-container', 'components/header.html');
  loadComponent('footer-container', 'components/footer.html');
  
  // Эффекты, которые могут зависеть от контента (инициализируем после DOMContentLoaded)
  // Но если элементы уже есть — запускаем сразу
  if (DOM.get('.card') || DOM.get('.gallery-item')) initCardTilt();
  if (DOM.get('#hero')) initHeroDepth();
  
  // Частицы
  createDust();
  
  // Плавный скролл (в конце, чтобы не блокировать рендер)
  initSmoothScroll();
}

// Запуск
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Плавное сворачивание/разворачивание комментариев
function toggleComments(btn) {
  const commentsList = btn.nextElementSibling;
  if (!commentsList) return;

  btn.classList.toggle('open');
  commentsList.classList.toggle('open');
}

// Экспорт для возможного использования в модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { init, loadComponent, initCardTilt, initHeroDepth };
}

// Dropdown
function initDropdownClick() {
  document.querySelectorAll('.nav-dropdown-toggle').forEach(toggle => {
    toggle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const parent = this.closest('.nav-dropdown');
      parent.classList.toggle('open');
      this.setAttribute('aria-expanded', parent.classList.contains('open'));
    });
  });

  // Закрытие при клике вне
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nav-dropdown')) {
      document.querySelectorAll('.nav-dropdown.open').forEach(d => {
        d.classList.remove('open');
        d.querySelector('.nav-dropdown-toggle')?.setAttribute('aria-expanded', 'false');
      });
    }
  });
}

// В конце init() добавь:
initDropdownClick();