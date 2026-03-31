// Загрузка header и footer
async function loadComponent(id, file) {
  try {
    const response = await fetch(file);
    if (response.ok) {
      const html = await response.text();
      document.getElementById(id).innerHTML = html;

      // После загрузки header инициализируем навигацию
      if (id === 'header-container') {
        initNav();
      }
      if (id === 'footer-container') {
        createBugs();
      }
    }
  } catch (e) {
    console.error(`Ошибка загрузки ${file}:`, e);
  }
}

// Создание фоновых эффектов
function createBackgroundEffects() {
  // Волны
  const waves = document.createElement('div');
  waves.className = 'bg-waves';
  document.body.appendChild(waves);

  // Туман
  const fog = document.createElement('div');
  fog.className = 'bg-fog';
  for (let i = 0; i < 5; i++) {
    const span = document.createElement('span');
    fog.appendChild(span);
  }
  document.body.appendChild(fog);

  // Северное сияние
  const aurora = document.createElement('div');
  aurora.className = 'bg-aurora';
  document.body.appendChild(aurora);
}

function initScrollProgress() {
  let progressBar = document.querySelector('.scroll-progress');
  if (!progressBar) {
    progressBar = document.createElement('div');
    progressBar.className = 'scroll-progress';
    document.body.appendChild(progressBar);
  }

  const updateProgress = () => {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const progress = maxScroll === 0 ? 1 : Math.min(1, Math.max(0, window.scrollY / maxScroll));
    progressBar.style.transform = `scaleX(${progress})`;
  };

  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
}

function initCursorGlow() {
  const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
  if (!hasFinePointer || prefersReducedMotion) {
    document.documentElement.style.setProperty('--cursor-x', '50%');
    document.documentElement.style.setProperty('--cursor-y', '50%');
    return;
  }

  window.addEventListener('mousemove', (e) => {
    document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`);
  }, { passive: true });
}

function initCardTilt() {
  if (prefersReducedMotion || !window.matchMedia('(pointer: fine)').matches) {
    return;
  }

  const cards = document.querySelectorAll('.card, .gallery-item');
  cards.forEach((card) => {
    if (card.dataset.tiltReady === '1') return;
    card.dataset.tiltReady = '1';
    const isGalleryCard = card.classList.contains('gallery-item');
    const tiltXMax = isGalleryCard ? 8 : 12;
    const tiltYMax = isGalleryCard ? 8 : 12;
    const hoverRaise = isGalleryCard ? -3.0 : -4.8;
    const easing = isGalleryCard ? 0.09 : 0.12;
    const shadowMul = isGalleryCard ? 1.1 : 1.4;
    const shadowBaseY = isGalleryCard ? 12 : 16;
    const shadowBlur = isGalleryCard ? 28 : 34;

    const state = {
      rx: 0,
      ry: 0,
      mx: 50,
      my: 50,
      raise: 0
    };
    const target = {
      rx: 0,
      ry: 0,
      mx: 50,
      my: 50,
      raise: 0
    };
    let rafId = null;

    const step = () => {
      state.rx += (target.rx - state.rx) * easing;
      state.ry += (target.ry - state.ry) * easing;
      state.mx += (target.mx - state.mx) * easing;
      state.my += (target.my - state.my) * easing;
      state.raise += (target.raise - state.raise) * easing;

      card.style.setProperty('--rx', `${state.rx.toFixed(2)}deg`);
      card.style.setProperty('--ry', `${state.ry.toFixed(2)}deg`);
      card.style.setProperty('--mx', `${state.mx.toFixed(2)}%`);
      card.style.setProperty('--my', `${state.my.toFixed(2)}%`);
      card.style.setProperty('--raise', `${state.raise.toFixed(2)}px`);
      const shadowX = (-state.ry * shadowMul).toFixed(2);
      const shadowY = (shadowBaseY + state.rx * (shadowMul * 0.8)).toFixed(2);
      card.style.setProperty('--depth-shadow', `${shadowX}px ${shadowY}px ${shadowBlur}px rgba(0,0,0,.26)`);

      const settled =
        Math.abs(target.rx - state.rx) < 0.02 &&
        Math.abs(target.ry - state.ry) < 0.02 &&
        Math.abs(target.mx - state.mx) < 0.05 &&
        Math.abs(target.my - state.my) < 0.05 &&
        Math.abs(target.raise - state.raise) < 0.02;

      if (settled) {
        rafId = null;
        return;
      }

      rafId = requestAnimationFrame(step);
    };

    const start = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(step);
      }
    };

    const onMove = (e) => {
      const rect = card.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      target.rx = (0.5 - py) * tiltXMax;
      target.ry = (px - 0.5) * tiltYMax;
      target.mx = px * 100;
      target.my = py * 100;
      target.raise = hoverRaise;
      start();
    };

    const reset = () => {
      target.rx = 0;
      target.ry = 0;
      target.mx = 50;
      target.my = 50;
      target.raise = 0;
      start();
    };

    card.addEventListener('pointerenter', () => {
      target.raise = hoverRaise;
      start();
    });
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', reset);
    card.addEventListener('pointercancel', reset);
  });
}

function initHeroDepth() {
  const hero = document.getElementById('hero');
  if (!hero) return;

  const setHeroVars = (rx, ry, shiftX, shiftY) => {
    hero.style.setProperty('--hero-rx', `${rx.toFixed(2)}deg`);
    hero.style.setProperty('--hero-ry', `${ry.toFixed(2)}deg`);
    hero.style.setProperty('--hero-shift-x', `${shiftX.toFixed(2)}px`);
    hero.style.setProperty('--hero-shift-y', `${shiftY.toFixed(2)}px`);
  };

  if (prefersReducedMotion || !window.matchMedia('(pointer: fine)').matches) {
    setHeroVars(0, 0, 0, 0);
    return;
  }

  const state = { rx: 0, ry: 0, shiftX: 0, shiftY: 0 };
  const target = { rx: 0, ry: 0, shiftX: 0, shiftY: 0 };
  let rafId = null;

  const step = () => {
    const ease = 0.1;
    state.rx += (target.rx - state.rx) * ease;
    state.ry += (target.ry - state.ry) * ease;
    state.shiftX += (target.shiftX - state.shiftX) * ease;
    state.shiftY += (target.shiftY - state.shiftY) * ease;
    setHeroVars(state.rx, state.ry, state.shiftX, state.shiftY);

    const settled =
      Math.abs(target.rx - state.rx) < 0.02 &&
      Math.abs(target.ry - state.ry) < 0.02 &&
      Math.abs(target.shiftX - state.shiftX) < 0.03 &&
      Math.abs(target.shiftY - state.shiftY) < 0.03;

    if (settled) {
      rafId = null;
      return;
    }

    rafId = requestAnimationFrame(step);
  };

  const start = () => {
    if (rafId === null) {
      rafId = requestAnimationFrame(step);
    }
  };

  const onMove = (e) => {
    const rect = hero.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));

    target.rx = (0.5 - py) * 7;
    target.ry = (px - 0.5) * 9;
    target.shiftX = (px - 0.5) * 18;
    target.shiftY = (py - 0.5) * 12;
    start();
  };

  const reset = () => {
    target.rx = 0;
    target.ry = 0;
    target.shiftX = 0;
    target.shiftY = 0;
    start();
  };

  hero.addEventListener('pointermove', onMove);
  hero.addEventListener('pointerleave', reset);
  hero.addEventListener('pointercancel', reset);
}

function initNav() {
  // Mobile menu
  const burger = document.querySelector('.burger');
  const mobile = document.querySelector('.mobile-menu');
  if (burger && mobile && burger.dataset.menuReady !== '1') {
    burger.dataset.menuReady = '1';

    const closeMenu = () => {
      mobile.classList.remove('is-open');
      burger.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('menu-open');
    };

    const openMenu = () => {
      mobile.classList.add('is-open');
      burger.classList.add('is-open');
      burger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('menu-open');
    };

    burger.addEventListener('click', () => {
      const isOpen = mobile.classList.contains('is-open');
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    mobile.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('click', (e) => {
      if (window.innerWidth > 768) return;
      if (!mobile.classList.contains('is-open')) return;
      if (burger.contains(e.target) || mobile.contains(e.target)) return;
      closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        closeMenu();
      }
    });
  }

  // Header highlight
  const highlight = document.querySelector('.nav-highlight');
  const links = document.querySelectorAll('.nav a');
  const currentURL = window.location.href;
  if (!highlight || links.length === 0) return;
  
  links.forEach(link => {
    if (currentURL.includes(link.getAttribute('href'))) {
      link.classList.add('active');
    }
    link.addEventListener('mouseenter', () => {
      const r = link.getBoundingClientRect();
      const n = link.parentElement.getBoundingClientRect();
      highlight.style.width = r.width + 'px';
      highlight.style.height = r.height + 'px';
      highlight.style.transform = `translate(${r.left - n.left}px, ${r.top - n.top}px)`;
      highlight.style.opacity = '1';
    });
  });
  
  if (document.querySelector('.nav')) {
    document.querySelector('.nav').addEventListener('mouseleave', () => {
      highlight.style.opacity = '0';
    });
  }
}

// Fade in animation
const obs = new IntersectionObserver(e => e.forEach(i => i.isIntersecting && i.target.classList.add('visible')), { threshold: .15 });
document.querySelectorAll('.fade').forEach(el => obs.observe(el));

// Загружаем header и footer при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  createBackgroundEffects();
  loadComponent('header-container', 'components/header.html');
  loadComponent('footer-container', 'components/footer.html');
  initScrollProgress();
  initCursorGlow();
  initCardTilt();
  initHeroDepth();
  createDust();
  createBugs();
});

// Умный header - скрывается при скролле вниз, показывается при скролле вверх
let lastScrollY = window.scrollY;
let ticking = false;

function toggleHeader() {
  const header = document.querySelector('.header');
  if (!header) return;
  
  const currentScrollY = window.scrollY;
  
  if (currentScrollY > lastScrollY && currentScrollY > 100) {
    // Скролл вниз - скрываем header
    header.classList.add('header-hidden');
  } else {
    // Скролл вверх - показываем header
    header.classList.remove('header-hidden');
  }
  
  lastScrollY = currentScrollY;
  ticking = false;
}

// Слушаем скролл для header
window.addEventListener('scroll', () => {
  if (!ticking) {
    requestAnimationFrame(toggleHeader);
    ticking = true;
  }
}, { passive: true });

// Плавная прокрутка без резкого торможения в конце
let currentScroll = window.scrollY;
let targetScroll = currentScroll;
let scrollRaf = null;
let isDraggingScrollbar = false;

const SCROLL_LERP = 0.14;
const SCROLL_STOP_EPSILON = 0.35;
const KEY_SCROLL_STEP = 100;
const SCROLLBAR_DRAG_ZONE = 20;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function getMaxScroll() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function clampTargetScroll() {
  targetScroll = Math.max(0, Math.min(targetScroll, getMaxScroll()));
}

function smoothScrollStep() {
  const delta = targetScroll - currentScroll;

  if (Math.abs(delta) <= SCROLL_STOP_EPSILON) {
    currentScroll = targetScroll;
    window.scrollTo(0, currentScroll);
    scrollRaf = null;
    return;
  }

  currentScroll += delta * SCROLL_LERP;
  window.scrollTo(0, currentScroll);
  scrollRaf = requestAnimationFrame(smoothScrollStep);
}

function startSmoothScroll() {
  if (scrollRaf === null) {
    scrollRaf = requestAnimationFrame(smoothScrollStep);
  }
}

function stopSmoothScroll() {
  if (scrollRaf !== null) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
  currentScroll = window.scrollY;
  targetScroll = currentScroll;
}

window.addEventListener('scroll', () => {
  if (scrollRaf === null && !isDraggingScrollbar) {
    currentScroll = window.scrollY;
    targetScroll = currentScroll;
  }
}, { passive: true });

window.addEventListener('wheel', (e) => {
  if (prefersReducedMotion || e.ctrlKey) {
    return;
  }

  e.preventDefault();
  isDraggingScrollbar = false;

  targetScroll += e.deltaY;
  clampTargetScroll();
  startSmoothScroll();
}, { passive: false });

window.addEventListener('mousedown', (e) => {
  if (e.clientX >= window.innerWidth - SCROLLBAR_DRAG_ZONE) {
    isDraggingScrollbar = true;
    stopSmoothScroll();
  }
});

window.addEventListener('mouseup', () => {
  if (isDraggingScrollbar) {
    isDraggingScrollbar = false;
    currentScroll = window.scrollY;
    targetScroll = currentScroll;
  }
});

window.addEventListener('resize', () => {
  clampTargetScroll();
  currentScroll = Math.max(0, Math.min(currentScroll, getMaxScroll()));
});

window.addEventListener('keydown', (e) => {
  if (prefersReducedMotion) {
    return;
  }

  if (e.key === 'Home') {
    e.preventDefault();
    targetScroll = 0;
    startSmoothScroll();
    return;
  }

  if (e.key === 'End') {
    e.preventDefault();
    targetScroll = getMaxScroll();
    startSmoothScroll();
    return;
  }

  let delta = 0;
  if (e.key === 'ArrowDown') {
    delta = KEY_SCROLL_STEP;
  } else if (e.key === 'ArrowUp') {
    delta = -KEY_SCROLL_STEP;
  } else if (e.key === 'PageDown') {
    delta = window.innerHeight * 0.9;
  } else if (e.key === 'PageUp') {
    delta = -window.innerHeight * 0.9;
  }

  if (delta !== 0) {
    e.preventDefault();
    targetScroll += delta;
    clampTargetScroll();
    startSmoothScroll();
  }
});

// Копирование текста из code-block
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('copy-btn')) {
    const codeBlock = e.target.closest('.code-block');
    const code = codeBlock.querySelector('code');
    if (code) {
      navigator.clipboard.writeText(code.textContent).then(() => {
        e.target.textContent = 'Скопировано!';
        e.target.classList.add('copied');
        setTimeout(() => {
          e.target.textContent = 'Копировать';
          e.target.classList.remove('copied');
        }, 2000);
      });
    }
  }
});

// Генерация пыли на фоне
function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randomizeDustParticle(span, useNegativeDelay = false) {
  const duration = randomRange(11, 19);
  const dx = randomRange(-90, 90);
  const dy = -window.innerHeight * randomRange(0.35, 1.2);
  const size = randomRange(1, 3);
  const opacity = randomRange(0.25, 0.75);
  const delay = useNegativeDelay ? -Math.random() * duration : 0;

  span.style.left = `${randomRange(0, 100).toFixed(2)}%`;
  span.style.top = `${randomRange(0, 100).toFixed(2)}%`;
  span.style.setProperty('--dx', `${dx.toFixed(2)}px`);
  span.style.setProperty('--dy', `${dy.toFixed(2)}px`);
  span.style.setProperty('--dust-size', `${size.toFixed(2)}px`);
  span.style.setProperty('--dust-opacity', opacity.toFixed(2));
  span.style.animationDuration = `${duration.toFixed(2)}s`;
  span.style.animationDelay = `${delay.toFixed(2)}s`;
}

function createDust() {
  const dustContainer = document.querySelector('.dust');
  if (!dustContainer) return;

  const particles = dustContainer.querySelectorAll('span');
  particles.forEach((span) => {
    if (span.dataset.dustReady === '1') return;
    span.dataset.dustReady = '1';

    randomizeDustParticle(span, true);
    span.addEventListener('animationiteration', () => {
      randomizeDustParticle(span);
    });
  });
}

function randomizeBugParticle(span, useNegativeDelay = false) {
  const duration = randomRange(24, 38);
  const delay = useNegativeDelay ? -Math.random() * duration : randomRange(0, 8);
  const left = randomRange(2, 98);
  const size = randomRange(1.8, 3.4);
  const glow = randomRange(0.18, 0.42);

  span.style.left = `${left.toFixed(2)}%`;
  span.style.width = `${size.toFixed(2)}px`;
  span.style.height = `${size.toFixed(2)}px`;
  span.style.animationDuration = `${duration.toFixed(2)}s`;
  span.style.animationDelay = `${delay.toFixed(2)}s`;
  span.style.boxShadow = `0 0 ${Math.max(2, size * 1.6).toFixed(2)}px rgba(100, 255, 100, ${glow.toFixed(2)})`;
}

function createBugs() {
  const bugsContainer = document.querySelector('.bugs');
  if (!bugsContainer) return;

  const particles = bugsContainer.querySelectorAll('span');
  particles.forEach((span) => {
    if (span.dataset.bugReady === '1') return;
    span.dataset.bugReady = '1';

    randomizeBugParticle(span);
    span.addEventListener('animationiteration', () => {
      randomizeBugParticle(span);
    });
  });
}
