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

// Ультраплавная прокрутка
let currentScroll = 0;
let targetScroll = 0;
let isScrolling = false;
let velocity = 0;
let isDragging = false;

function smoothScroll() {
  const delta = targetScroll - currentScroll;
  const distance = Math.abs(delta);
  
  // Вычисляем скорость с инерцией
  const targetVelocity = delta * 0.1;
  velocity = velocity * 0.85 + targetVelocity * 0.15;
  
  // Замедление в конце
  if (distance < 50) {
    velocity *= 0.7;
  }
  if (distance < 10) {
    velocity *= 0.5;
  }
  if (distance < 3) {
    velocity *= 0.3;
  }
  
  currentScroll += velocity;
  
  // Ограничиваем скролл
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  currentScroll = Math.max(0, Math.min(currentScroll, maxScroll));
  
  window.scrollTo(0, currentScroll);
  
  // Продолжаем если есть движение
  if (Math.abs(velocity) > 0.01 || distance > 0.1) {
    requestAnimationFrame(smoothScroll);
  } else {
    isScrolling = false;
    velocity = 0;
  }
}

// Синхронизация при перетаскивании скроллбара
window.addEventListener('scroll', () => {
  if (!isScrolling && !isDragging) {
    currentScroll = window.scrollY;
    targetScroll = currentScroll;
    velocity = 0;
  }
}, { passive: true });

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  isDragging = false;
  
  targetScroll += e.deltaY;
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
  
  if (!isScrolling) {
    isScrolling = true;
    smoothScroll();
  }
}, { passive: false });

// Отслеживание перетаскивания скроллбара
window.addEventListener('mousedown', (e) => {
  // Проверяем, кликнули ли по скроллбару (приблизительно)
  if (e.clientX > window.innerWidth - 20) {
    isDragging = true;
    isScrolling = false;
    velocity = 0;
  }
});

window.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    currentScroll = window.scrollY;
    targetScroll = currentScroll;
  }
});

// Обработка клавиш клавиатуры
window.addEventListener('keydown', (e) => {
  const step = 100;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    e.preventDefault();
    targetScroll += e.key === 'PageDown' ? window.innerHeight : step;
    const maxScroll = document.body.scrollHeight - window.innerHeight;
    targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));
    if (!isScrolling) {
      isScrolling = true;
      smoothScroll();
    }
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault();
    targetScroll -= e.key === 'PageUp' ? window.innerHeight : step;
    targetScroll = Math.max(0, Math.min(targetScroll, document.body.scrollHeight - window.innerHeight));
    if (!isScrolling) {
      isScrolling = true;
      smoothScroll();
    }
  }
});
