const toast = document.querySelector('#toast');
let timer;
document.querySelectorAll('[data-copy-link]').forEach(button => button.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast.textContent = 'Guide link copied';
  } catch {
    toast.textContent = 'Copy the link from your browser’s address bar.';
  }
  toast.style.display = 'block';
  clearTimeout(timer);
  timer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}));
const links = [...document.querySelectorAll('nav a')];
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    for (const link of links) {
      const active = link.hash === `#${entry.target.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
}, { rootMargin: '-15% 0px -60% 0px' });
document.querySelectorAll('main section').forEach(section => observer.observe(section));
