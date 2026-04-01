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
  const links = DOM.getAll('.nav a');
  
  if (!highlight || links.length === 0) return;

  // Подсветка активной ссылки
  const currentURL = window.location.href;
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href && currentURL.includes(href)) {
      link.classList.add('active');
    }
  });

  // Анимация ховера
  const onEnter = (e) => {
    const link = e.currentTarget;
    const r = link.getBoundingClientRect();
    const n = link.parentElement.getBoundingClientRect();
    
    highlight.style.width = `${r.width}px`;
    highlight.style.height = `${r.height}px`;
    highlight.style.transform = `translate(${r.left - n.left}px, ${r.top - n.top}px)`;
    highlight.style.opacity = '1';
  };

  links.forEach(link => {
    link.addEventListener('mouseenter', onEnter, { passive: true });
  });
  
  nav?.addEventListener('mouseleave', () => {
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
    
    // Сохраняем ссылку на старое содержимое для очистки слушателей (опционально)
    container.innerHTML = html;

    // Инициализация после загрузки
    if (id === 'header-container') {
      DOM.clear(); // сброс кэша после изменения DOM
      initNav();
      initSmartHeader();
    }
    if (id === 'footer-container') {
      createBugs();
    }
  } catch (e) {
    console.error(`❌ Ошибка загрузки ${file}:`, e);
    // Fallback: можно показать заглушку
  }
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

// Экспорт для возможного использования в модулях
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { init, loadComponent, initCardTilt, initHeroDepth };
}