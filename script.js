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
    }
  } catch (e) {
    console.error(`Ошибка загрузки ${file}:`, e);
  }
}

function initNav() {
  // Header highlight
  const highlight = document.querySelector('.nav-highlight');
  const links = document.querySelectorAll('.nav a');
  const currentURL = window.location.href;
  
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
  
  // Mobile menu
  const burger = document.querySelector('.burger');
  const mobile = document.querySelector('.mobile-menu');
  if (burger && mobile) {
    burger.addEventListener('click', () => {
      mobile.style.display = mobile.style.display === 'flex' ? 'none' : 'flex';
    });
  }
}

// Fade in animation
const obs = new IntersectionObserver(e => e.forEach(i => i.isIntersecting && i.target.classList.add('visible')), { threshold: .15 });
document.querySelectorAll('.fade').forEach(el => obs.observe(el));

// Параллакс для главной страницы
const hero = document.getElementById('hero');
if (hero) {
  document.addEventListener('mousemove', (e) => {
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    hero.style.transform = `translate(${-x*20}px, ${-y*10}px)`;
  });
}

// Загружаем header и footer при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  loadComponent('header-container', 'components/header.html');
  loadComponent('footer-container', 'components/footer.html');
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
function createDust() {
  const dustContainer = document.querySelector('.dust');
  if (!dustContainer) return;
  
  const particles = dustContainer.querySelectorAll('span');
  particles.forEach(span => {
    const randomX = (Math.random() - 0.5) * 100;
    const randomY = -Math.random() * 100 - 50;
    span.style.setProperty('--dx', randomX + 'px');
    span.style.setProperty('--dy', randomY + 'px');
    span.style.top = Math.random() * 100 + '%';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  loadComponent('header-container', 'components/header.html');
  loadComponent('footer-container', 'components/footer.html');
  createDust();
});
