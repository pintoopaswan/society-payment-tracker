/**
 * MIG Society - Futuristic Theme Shared Logic
 */

/* ── Auth Check ── */
const AUTH_KEY = "society_dashboard_auth";
if (!sessionStorage.getItem(AUTH_KEY)) sessionStorage.setItem(AUTH_KEY, "true");

/* ── 3D Background (Three.js) ── */
function init3DBg() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const particlesGeometry = new THREE.BufferGeometry();
  const particlesCount = 2000;
  const posArray = new Float32Array(particlesCount * 3);
  for(let i=0; i<particlesCount*3; i++) {
    posArray[i] = (Math.random() - 0.5) * 10;
  }
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  const material = new THREE.PointsMaterial({
    size: 0.008,
    color: 0x00f2ff,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });
  const particlesMesh = new THREE.Points(particlesGeometry, material);
  scene.add(particlesMesh);
  camera.position.z = 3;

  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 0.5;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 0.5;
  });

  function animate() {
    requestAnimationFrame(animate);
    particlesMesh.rotation.y += 0.001 + mouseX * 0.05;
    particlesMesh.rotation.x += 0.0005 + mouseY * 0.05;
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ── UI Interactivity ── */
function initThemeUI() {
  // Sidebar toggle
  const sidebar = document.getElementById("sidebar");
  const mainContent = document.getElementById("mainContent");
  const sidebarToggle = document.getElementById("sidebarToggle");

  if (sidebar && mainContent && sidebarToggle) {
    let sidebarCollapsed = localStorage.getItem("sb_collapsed") === "1";

    const applySidebar = () => {
      if(sidebarCollapsed){
        sidebar.classList.add("collapsed");
        mainContent.classList.add("sidebar-collapsed");
      } else {
        sidebar.classList.remove("collapsed");
        mainContent.classList.remove("sidebar-collapsed");
      }
    };

    applySidebar();

    sidebarToggle.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem("sb_collapsed", sidebarCollapsed ? "1" : "0");
      applySidebar();
    });
  }

  // Mobile drawer
  const mobOverlay = document.getElementById("mobOverlay");
  const mobDrawer = document.getElementById("mobDrawer");
  const mobMenuBtn = document.getElementById("mobMenuBtn");

  if (mobOverlay && mobDrawer && mobMenuBtn) {
    const openDrawer = () => {
      mobDrawer.classList.add("open");
      mobOverlay.classList.add("open");
      document.body.classList.add("modal-open");
    };
    const closeDrawer = () => {
      mobDrawer.classList.remove("open");
      mobOverlay.classList.remove("open");
      document.body.classList.remove("modal-open");
    };
    mobMenuBtn.addEventListener("click", openDrawer);
    mobOverlay.addEventListener("click", closeDrawer);
  }

  // Profile dropdowns
  document.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = btn.nextElementSibling;
      if (dropdown && dropdown.classList.contains('profile-dropdown')) {
        const isOpen = dropdown.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      }
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.profile-dropdown').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.profile-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  });

  // Tilt effects - Expanded to cover legacy classes
  if (window.VanillaTilt) {
    VanillaTilt.init(document.querySelectorAll('.card, .kpi-cell, .qt, .section-card, .pay-section, .search-hero, .search-prompt, .table-card, .mob-card, .filter-bar'), {
      max: 5,
      speed: 400,
      glare: true,
      "max-glare": 0.2
    });
  }
}

/* ── Global Init ── */
document.addEventListener('DOMContentLoaded', () => {
  init3DBg();
  initThemeUI();
});
