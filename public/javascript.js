// ==================== CONFIGURACIÓN DE API ====================
const API_URL = window.location.origin + '/api';
let adminKey = localStorage.getItem('adminKey') || '';

// ==================== DATOS BASE ====================
const ESTADOS_MEXICO = [
    'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas',
    'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango',
    'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco',
    'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca',
    'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa',
    'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz',
    'Yucatán', 'Zacatecas'
];

// ==================== ESTADO GLOBAL ====================
let currentUser = null;
let materiales = [];
let reportes = [];
let publicacionesMK = [];
let calificaciones = [];
let reportesVendedor = [];
let ofertas = [];
let alertas = [];
let sugerenciasMateriales = [];

let currentView = 'cards';
let chartInstance = null;

// ==================== SOCKET.IO ====================
const socket = io();
socket.on('nuevo_reporte', () => {
    cargarDatosIniciales();
    mostrarDashboard(false);
});
socket.on('nueva_publicacion', async () => {
    publicacionesMK = await apiFetch(`${API_URL}/marketplace`);
    mostrarMarketplace(false);
});

// ==================== SISTEMA ANTI-REVENDEDORES ====================
const UMBRAL_SOSPECHOSO = 0.30;
const UMBRAL_CRITICO = 0.50;
const MAX_REPORTES_ATIPICOS = 3;

function analizarPrecio(precio, materialId, estado) {
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const zonaVerificados = reportes.filter(r =>
        r.material_id === materialId &&
        r.estado === estado &&
        r.fecha >= hace30 &&
        r.verificado === true
    );
    if (zonaVerificados.length < 3) return { nivel: 'normal', mensaje: '', esAtipico: false };
    let spv = 0, sv = 0;
    zonaVerificados.forEach(r => { const v = r.volumen_ton || 1; spv += r.precio_kg * v; sv += v; });
    const promedio = spv / sv;
    const desviacion = Math.abs(precio - promedio) / promedio;
    if (desviacion > UMBRAL_CRITICO) {
        return { nivel: 'critico', mensaje: `⚠️ El precio está ${((desviacion)*100).toFixed(0)}% ${precio < promedio ? 'por debajo' : 'por encima'} del promedio de la zona ($${promedio.toFixed(2)}/kg). ¿Estás seguro de este valor?`, esAtipico: true };
    } else if (desviacion > UMBRAL_SOSPECHOSO) {
        return { nivel: 'sospechoso', mensaje: `El precio difiere en ${((desviacion)*100).toFixed(0)}% del promedio de la zona ($${promedio.toFixed(2)}/kg). Por favor verifica tu dato.`, esAtipico: false };
    }
    return { nivel: 'normal', mensaje: '', esAtipico: false };
}

function obtenerConfianzaVendedor(email) {
    const reportesAtipicos = reportes.filter(r => r.usuario === email && r.verificado === false).length;
    const reportesTotal = reportes.filter(r => r.usuario === email).length;
    if (reportesTotal === 0) return { nivel: 'normal', score: 100, label: 'Nuevo' };
    const ratio = reportesAtipicos / reportesTotal;
    if (ratio > 0.5 || reportesAtipicos >= MAX_REPORTES_ATIPICOS) return { nivel: 'low', score: Math.max(0, 100 - (ratio * 100)), label: 'Baja' };
    else if (ratio > 0.2) return { nivel: 'medium', score: Math.max(0, 100 - (ratio * 100)), label: 'Media' };
    return { nivel: 'high', score: 100 - (ratio * 100), label: 'Alta' };
}

function calcularConfianzaMercado() {
    const reportesVerificados = reportes.filter(r => r.verificado === true).length;
    const reportesAtipicos = reportes.filter(r => r.verificado === false).length;
    const total = reportesVerificados + reportesAtipicos;
    if (total === 0) return { nivel: 'high', label: 'Alta' };
    const ratio = reportesVerificados / total;
    if (ratio > 0.8) return { nivel: 'high', label: 'Alta' };
    if (ratio > 0.5) return { nivel: 'medium', label: 'Media' };
    return { nivel: 'low', label: 'Baja' };
}

// ==================== CONFIGURACIÓN DE ANUNCIOS ====================
let CONFIG_ANUNCIOS = JSON.parse(localStorage.getItem('precioMolido_anuncios')) || {
    hero: { secciones: ['dashboard'], img: '', link: '', alt: 'Anuncio hero' },
    inline: { secciones: ['dashboard'], img: '', link: '', alt: 'Anuncio inline' },
    report: { secciones: ['reportar'], img: '', link: '', alt: 'Anuncio report' },
    sidebar: { secciones: ['dashboard','ranking','alertas'], img: '', link: '', alt: 'Anuncio sidebar' },
    footer: { secciones: ['dashboard','reportar','marketplace','ranking','alertas'], img: '', link: '', alt: 'Anuncio footer' }
};
function guardarConfigAnuncios() { localStorage.setItem('precioMolido_anuncios', JSON.stringify(CONFIG_ANUNCIOS)); }

// ==================== FUNCIONES DE API ====================
function getAuthHeaders() {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (adminKey) headers['x-admin-key'] = adminKey;
    return headers;
}

async function apiFetch(url, options = {}) {
    const res = await fetch(url, { headers: getAuthHeaders(), ...options });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
}

async function cargarDatosIniciales() {
    try {
        reportes = await apiFetch(`${API_URL}/reportes`);
        publicacionesMK = await apiFetch(`${API_URL}/marketplace`);
        materiales = await apiFetch(`${API_URL}/materiales`);
        sugerenciasMateriales = await apiFetch(`${API_URL}/sugerencias-materiales`).catch(() => []);
        calificaciones = await apiFetch(`${API_URL}/calificaciones/todas`).catch(() => []);
        reportesVendedor = await apiFetch(`${API_URL}/reportes-vendedor`).catch(() => []);
    } catch (error) {
        console.error(error);
        showToast('Error al cargar datos del servidor', 'error');
    }
}

async function cargarDatosUsuario() {
    if (!currentUser) return;
    try {
        alertas = await apiFetch(`${API_URL}/alertas`);
        const [rec, env] = await Promise.all([
            apiFetch(`${API_URL}/ofertas/recibidas`).catch(() => []),
            apiFetch(`${API_URL}/ofertas/enviadas`).catch(() => [])
        ]);
        ofertas = [...rec, ...env];
    } catch (e) { console.error(e); }
}

// ==================== TOASTS Y CONFIRMACIÓN ====================
function showToast(mensaje, tipo = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    const iconos = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    toast.innerHTML = `<span class="toast-icon">${iconos[tipo] || iconos.info}</span>${mensaje}<button class="toast-close">×</button>`;
    container.appendChild(toast);
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    setTimeout(() => toast.remove(), 4000);
}

function confirmModal(mensaje) {
    return new Promise((resolve) => {
        const bg = document.createElement('div');
        bg.className = 'confirm-modal-bg';
        bg.innerHTML = `<div class="confirm-modal"><p>${mensaje}</p><div class="confirm-btns"><button class="btn btn-primary" id="confirmSi">Sí</button><button class="btn btn-ghost" id="confirmNo">No</button></div></div>`;
        document.body.appendChild(bg);
        bg.querySelector('#confirmSi').onclick = () => { bg.remove(); resolve(true); };
        bg.querySelector('#confirmNo').onclick = () => { bg.remove(); resolve(false); };
        bg.addEventListener('click', (e) => { if (e.target === bg) { bg.remove(); resolve(false); } });
    });
}

// ==================== DEBOUNCE ====================
function debounce(fn, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ==================== NOTIFICACIONES ====================
function dispararNotificacionesAlerta(reporte) {
    if (!currentUser) return;
    alertas.filter(a => a.activa && a.material_id === reporte.material_id && a.estado === reporte.estado).forEach(alerta => {
        const disp = (alerta.condicion === 'debajo' && reporte.precio_kg <= alerta.precio_objetivo) || (alerta.condicion === 'arriba' && reporte.precio_kg >= alerta.precio_objetivo);
        if (disp) { showToast(`🔔 Alerta alcanzada`, 'warning'); apiFetch(`${API_URL}/alertas/${alerta.id}`, { method: 'DELETE' }).catch(() => {}); }
    });
    actualizarBadgeAlertas();
}

function actualizarBadgeAlertas() {
    const badge = document.getElementById('alertasBadge');
    if (!badge || !currentUser) { if (badge) badge.style.display = 'none'; return; }
    badge.textContent = alertas.filter(a => a.activa).length;
    badge.style.display = badge.textContent > 0 ? 'inline-flex' : 'none';
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    await cargarDatosIniciales();
    await verificarSesion();
    poblarSelectores();
    mostrarDashboard();
    actualizarIndicadorConfianza();
    configurarNavegacion();
    configurarHamburguesa();
    configurarModals();
    configurarFormularioReporte();
    configurarFormularioAlerta();
    configurarFormularioNewsletter();
    configurarThemeToggle();
    configurarViewToggle();
    configurarAuth();
    configurarMarketplace();
    configurarCalificaciones();
    configurarReportes();
    configurarOfertas();
    configurarFotoPreview();
    if (currentUser) {
        actualizarUIUsuario();
        await cargarDatosUsuario();
        mostrarMarketplace();
    }
    configurarClickAfueraDropdown();
    configurarVerificacionPrecioReporte();
    configurarVerificacionPrecioMarketplace();
    document.getElementById('formAdminLogin').addEventListener('submit', adminLogin);
    document.getElementById('formAdminAnuncios').addEventListener('submit', adminGuardarAnuncio);
    document.getElementById('btnCerrarAdmin').addEventListener('click', cerrarAdmin);
    document.getElementById('closeAdmin').addEventListener('click', cerrarAdmin);
    document.getElementById('closeSugerirMaterial').addEventListener('click', () => {
        document.getElementById('modalSugerirMaterial').style.display = 'none';
    });
    document.getElementById('formSugerirMaterial').addEventListener('submit', enviarSugerenciaMaterial);
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            const tipo = this.dataset.admintab;
            const panels = ['formAdminAnuncios','adminMateriales','adminReportes','adminMarketplace','adminUsuarios'];
            panels.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
            if (tipo === 'materiales') {
                document.getElementById('adminMateriales').style.display = 'block';
                mostrarAdminMateriales();
            } else if (tipo === 'reportesAdmin') {
                document.getElementById('adminReportes').style.display = 'block';
                cargarAdminReportes();
            } else if (tipo === 'marketplaceAdmin') {
                document.getElementById('adminMarketplace').style.display = 'block';
                cargarAdminMarketplace();
            } else if (tipo === 'usuarios') {
                document.getElementById('adminUsuarios').style.display = 'block';
                cargarAdminUsuarios();
            } else {
                document.getElementById('formAdminAnuncios').style.display = 'flex';
                cambiarTabAdmin(tipo);
            }
        });
    });
    document.getElementById('searchDashboard').addEventListener('input', debounce(mostrarDashboard, 300));
    document.getElementById('sortDashboard').addEventListener('change', mostrarDashboard);
    document.getElementById('searchMarketplace').addEventListener('input', debounce(mostrarMarketplace, 300));
    document.getElementById('sortMarketplace').addEventListener('change', mostrarMarketplace);
    document.getElementById('btnLoadMoreDashboard').addEventListener('click', () => {
        dashboardPaginaActual++;
        mostrarDashboard(false);
    });
    document.getElementById('btnLoadMoreMarketplace').addEventListener('click', () => {
        marketplacePaginaActual++;
        mostrarMarketplace(false);
    });
    actualizarBadgeAlertas();
});

// ==================== AUTENTICACIÓN ====================
async function login(email, password) {
    try {
        const data = await apiFetch(`${API_URL}/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        return true;
    } catch (e) { showToast(e.message, 'error'); return false; }
}

async function registro(nombre, email, password, tipo, estado) {
    try {
        const data = await apiFetch(`${API_URL}/registro`, { method: 'POST', body: JSON.stringify({ nombre, email, password, tipo, estado }) });
        localStorage.setItem('token', data.token);
        currentUser = data.user;
        return true;
    } catch (e) { showToast(e.message, 'error'); return false; }
}

function cerrarSesion() {
    localStorage.removeItem('token');
    currentUser = null;
    alertas = [];
    ofertas = [];
    actualizarUIUsuario();
    mostrarDashboard();
    showToast('Sesión cerrada', 'info');
}

async function verificarSesion() {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        currentUser = { nombre: payload.nombre, email: payload.email, tipo: '', estado: '' };
        await cargarDatosUsuario();
        actualizarBadgeAlertas();
    } catch (e) { localStorage.removeItem('token'); }
}

function actualizarUIUsuario() {
    const btnLogin = document.getElementById('btnLogin');
    const userMenu = document.getElementById('userMenu');
    const userNameDisplay = document.getElementById('userNameDisplay');
    if (currentUser) {
        btnLogin.style.display = 'none';
        userMenu.style.display = 'block';
        userNameDisplay.textContent = currentUser.nombre;
    } else {
        btnLogin.style.display = 'inline-flex';
        userMenu.style.display = 'none';
    }
}

// ==================== POBLAR SELECTORES ====================
function poblarSelectores() {
    const selectores = [
        { id: 'filterMaterial', valores: [...new Set(materiales.map(m => m.material))] },
        { id: 'filterEstado', valores: ESTADOS_MEXICO },
        { id: 'estado', valores: ESTADOS_MEXICO },
        { id: 'authEstado', valores: ESTADOS_MEXICO },
        { id: 'newsletterEstado', valores: ESTADOS_MEXICO },
        { id: 'alertaEstado', valores: ESTADOS_MEXICO },
    ];
    selectores.forEach(s => {
        const el = document.getElementById(s.id);
        if (!el) return;
        el.innerHTML = s.id === 'filterMaterial' ? '<option value="todos">Todos los materiales</option>' : '<option value="todos">Todos los estados</option>';
        s.valores.forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.textContent = v; el.appendChild(opt); });
    });

    ['material','alertaMaterial'].forEach(sid => {
        const el = document.getElementById(sid);
        if (!el) return;
        el.innerHTML = '<option value="">Selecciona un material</option>';
        materiales.forEach(mat => { const opt = document.createElement('option'); opt.value = mat.id; opt.textContent = `${mat.material} - ${mat.color} (${mat.presentacion}, ${mat.origen})`; el.appendChild(opt); });
    });

    ['mkMaterial','mkFilterMaterial'].forEach(sid => {
        const el = document.getElementById(sid);
        if (!el) return;
        el.innerHTML = sid === 'mkMaterial' ? '<option value="">Selecciona material</option>' : '<option value="todos">Todos</option>';
        materiales.forEach(mat => { const opt = document.createElement('option'); opt.value = mat.id; opt.textContent = `${mat.material} - ${mat.color} (${mat.presentacion})`; el.appendChild(opt); });
    });

    ['mkEstado','mkFilterEstado'].forEach(sid => {
        const el = document.getElementById(sid);
        if (!el) return;
        el.innerHTML = sid === 'mkFilterEstado' ? '<option value="todos">Todos</option>' : '<option value="">Selecciona</option>';
        ESTADOS_MEXICO.forEach(e => { const opt = document.createElement('option'); opt.value = e; opt.textContent = e; el.appendChild(opt); });
    });

    const regEstado = document.getElementById('regEstado');
    if (regEstado) {
        regEstado.innerHTML = '<option value="">Selecciona</option>';
        ESTADOS_MEXICO.forEach(e => { const opt = document.createElement('option'); opt.value = e; opt.textContent = e; regEstado.appendChild(opt); });
    }
}

// ==================== NAVEGACIÓN ====================
function configurarNavegacion() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const panelName = link.dataset.panel;
            document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById(`panel-${panelName}`);
            if (panel) panel.classList.add('active');
            switch(panelName) {
                case 'dashboard': mostrarDashboard(); break;
                case 'reportar': mostrarPanelReporte(); break;
                case 'marketplace': mostrarMarketplace(); break;
                case 'ranking': mostrarRanking(); break;
                case 'alertas': mostrarAlertas(); break;
                case 'micuenta': mostrarCuenta(); break;
            }
            cargarAnuncios(panelName);
            document.getElementById('mainNav').classList.remove('open');
            document.getElementById('hamburgerBtn').classList.remove('open');
            document.getElementById('navOverlay').classList.remove('open');
            document.body.style.overflow = '';
        });
    });
    cargarAnuncios('dashboard');
}

function navegarACuenta() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-micuenta').classList.add('active');
    mostrarCuenta();
    document.getElementById('userDropdownMenu').style.display = 'none';
    cargarAnuncios('micuenta');
}

function navegarAMarketplace() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector('[data-panel="marketplace"]').classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-marketplace').classList.add('active');
    mostrarMarketplace();
    document.getElementById('userDropdownMenu').style.display = 'none';
    cargarAnuncios('marketplace');
}

// ==================== HAMBURGUESA ====================
function configurarHamburguesa() {
    const btn = document.getElementById('hamburgerBtn');
    const nav = document.getElementById('mainNav');
    const overlay = document.getElementById('navOverlay');
    function abrirMenu() { nav.classList.add('open'); btn.classList.add('open'); btn.setAttribute('aria-expanded','true'); if(overlay) overlay.classList.add('open'); document.body.style.overflow = 'hidden'; }
    function cerrarMenu() { nav.classList.remove('open'); btn.classList.remove('open'); btn.setAttribute('aria-expanded','false'); if(overlay) overlay.classList.remove('open'); document.body.style.overflow = ''; }
    btn.addEventListener('click', (e) => { e.stopPropagation(); nav.classList.contains('open') ? cerrarMenu() : abrirMenu(); });
    nav.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', cerrarMenu));
    if(overlay) overlay.addEventListener('click', cerrarMenu);
    document.addEventListener('click', (e) => { if(nav.classList.contains('open') && !nav.contains(e.target) && e.target !== btn) cerrarMenu(); });
}

// ==================== THEME TOGGLE ====================
function configurarThemeToggle() {
    const btn = document.getElementById('themeToggle');
    const icon = btn.querySelector('.theme-icon');
    icon.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';
    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        icon.textContent = next === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('precioMolido_theme', next);
    });
}

// ==================== VIEW TOGGLE ====================
function configurarViewToggle() {
    document.getElementById('viewCards').addEventListener('click', () => {
        currentView = 'cards';
        document.getElementById('viewCards').classList.add('active'); document.getElementById('viewCards').classList.remove('btn-ghost');
        document.getElementById('viewTable').classList.add('btn-ghost'); document.getElementById('viewTable').classList.remove('active');
        document.getElementById('priceCards').style.display = 'grid';
        document.getElementById('priceTable').style.display = 'none';
    });
    document.getElementById('viewTable').addEventListener('click', () => {
        currentView = 'table';
        document.getElementById('viewTable').classList.add('active'); document.getElementById('viewTable').classList.remove('btn-ghost');
        document.getElementById('viewCards').classList.add('btn-ghost'); document.getElementById('viewCards').classList.remove('active');
        document.getElementById('priceCards').style.display = 'none';
        document.getElementById('priceTable').style.display = 'block';
    });
}

// ==================== DROPDOWN ====================
function toggleUserDropdown() { const m = document.getElementById('userDropdownMenu'); m.style.display = m.style.display === 'none' ? 'block' : 'none'; }
function configurarClickAfueraDropdown() {
    document.addEventListener('click', (e) => {
        const userMenu = document.getElementById('userMenu');
        const dropdown = document.getElementById('userDropdownMenu');
        if (userMenu && dropdown && !userMenu.contains(e.target)) dropdown.style.display = 'none';
    });
}

// ==================== DASHBOARD ====================
const ITEMS_POR_PAGINA = 12;
let dashboardPaginaActual = 1;
let dashboardDatosFiltrados = [];

function obtenerReportesFiltrados() {
    const filterMaterial = document.getElementById('filterMaterial').value;
    const filterEstado = document.getElementById('filterEstado').value;
    const filterOperacion = document.getElementById('filterOperacion').value;
    const filterCalidad = document.getElementById('filterCalidad').value;
    const searchTerm = document.getElementById('searchDashboard')?.value?.toLowerCase() || '';
    const hace30Dias = new Date(); hace30Dias.setDate(hace30Dias.getDate() - 30);
    const fechaLimite = hace30Dias.toISOString().split('T')[0];
    let filtrados = reportes.filter(r => r.fecha >= fechaLimite);
    if (filterMaterial !== 'todos') { const ids = materiales.filter(m => m.material === filterMaterial).map(m => m.id); filtrados = filtrados.filter(r => ids.includes(r.material_id)); }
    if (filterEstado !== 'todos') filtrados = filtrados.filter(r => r.estado === filterEstado);
    if (filterOperacion !== 'todos') filtrados = filtrados.filter(r => r.tipo_operacion === filterOperacion);
    if (filterCalidad === 'verificados') filtrados = filtrados.filter(r => r.verificado === true);
    if (searchTerm) filtrados = filtrados.filter(r => { const mat = materiales.find(m => m.id === r.material_id); return mat && (mat.material.toLowerCase().includes(searchTerm) || mat.color.toLowerCase().includes(searchTerm) || r.estado.toLowerCase().includes(searchTerm)); });
    return filtrados;
}

function calcularPromedios(reportesFiltrados) {
    const agrupado = {};
    reportesFiltrados.forEach(r => {
        const key = `${r.material_id}-${r.estado}-${r.tipo_operacion}`;
        if (!agrupado[key]) agrupado[key] = { material_id: r.material_id, estado: r.estado, tipo_operacion: r.tipo_operacion, sumaPV: 0, sumaV: 0, precios: [], count: 0, todosVerificados: true };
        const vol = r.volumen_ton || 1;
        agrupado[key].sumaPV += r.precio_kg * vol;
        agrupado[key].sumaV += vol;
        agrupado[key].precios.push(r.precio_kg);
        agrupado[key].count++;
        if (!r.verificado) agrupado[key].todosVerificados = false;
    });
    return Object.values(agrupado);
}

function mostrarDashboard(resetPage = true) {
    if (resetPage) dashboardPaginaActual = 1;
    const filtrados = obtenerReportesFiltrados();
    dashboardDatosFiltrados = calcularPromedios(filtrados);
    const sortValue = document.getElementById('sortDashboard')?.value || '';
    if (sortValue === 'precio-asc') dashboardDatosFiltrados.sort((a, b) => (a.sumaPV/a.sumaV) - (b.sumaPV/b.sumaV));
    else if (sortValue === 'precio-desc') dashboardDatosFiltrados.sort((a, b) => (b.sumaPV/b.sumaV) - (a.sumaPV/a.sumaV));
    const totalPaginas = Math.ceil(dashboardDatosFiltrados.length / ITEMS_POR_PAGINA);
    const inicio = (dashboardPaginaActual - 1) * ITEMS_POR_PAGINA;
    const paginaDatos = dashboardDatosFiltrados.slice(inicio, inicio + ITEMS_POR_PAGINA);
    const cardsContainer = document.getElementById('priceCards');
    cardsContainer.innerHTML = '';
    if (paginaDatos.length === 0) {
        cardsContainer.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:40px;">No hay datos para los filtros seleccionados.</p>';
    } else {
        const fragment = document.createDocumentFragment();
        paginaDatos.forEach(entry => fragment.appendChild(crearTarjetaDashboard(entry)));
        cardsContainer.appendChild(fragment);
    }
    actualizarTablaDashboard(paginaDatos);
    document.getElementById('transparencyNote').textContent = `Mostrando ${paginaDatos.length} de ${dashboardDatosFiltrados.length} promedios. Datos basados en ${filtrados.length} reportes.`;
    const btnLoadMore = document.getElementById('btnLoadMoreDashboard');
    if (btnLoadMore) btnLoadMore.style.display = dashboardPaginaActual < totalPaginas ? 'inline-block' : 'none';
}

function crearTarjetaDashboard(entry) {
    const material = materiales.find(m => m.id === entry.material_id);
    if (!material) return document.createElement('div');
    const precioProm = entry.sumaPV / entry.sumaV;
    const precioMin = Math.min(...entry.precios);
    const precioMax = Math.max(...entry.precios);
    const tendencia = Math.random() > 0.6 ? 'up' : (Math.random() > 0.5 ? 'down' : 'stable');
    const tendenciaTexto = tendencia === 'up' ? '📈 Al alza' : (tendencia === 'down' ? '📉 A la baja' : '➡ Estable');
    const tendenciaClase = `tendencia-${tendencia}`;
    const esAtipico = !entry.todosVerificados;
    const card = document.createElement('div');
    card.className = `price-card ${esAtipico ? 'atipico' : ''}`;
    card.innerHTML = `
        <div class="price-card-header"><div><div class="price-card-material">${material.material}</div><div style="font-size:0.85rem;color:var(--gray-500);">${material.presentacion} · ${material.color} · ${material.origen}</div></div><span class="price-card-badge ${entry.tipo_operacion === 'Compra' ? 'badge-compra' : 'badge-venta'}">${entry.tipo_operacion}</span></div>
        <div class="price-card-body"><div class="price-card-precio">$${precioProm.toFixed(2)} <span class="price-card-unidad">MXN/kg</span></div><div class="price-card-rango">Rango: $${precioMin.toFixed(2)} - $${precioMax.toFixed(2)}</div><span class="price-card-tendencia ${tendenciaClase}">${tendenciaTexto}</span></div>
        <div class="price-card-footer"><span>📍 ${entry.estado}</span><span>📊 ${entry.count} reportes</span></div>
        <div class="price-card-calidad ${entry.todosVerificados ? 'calidad-verificada' : 'calidad-atipica'}">${entry.todosVerificados ? '✅ Datos verificados' : '⚠️ Contiene datos atípicos'}</div>
        <div class="price-card-historial" data-material="${material.material}" data-estado="${entry.estado}">📈 Ver histórico →</div>
    `;
    card.querySelector('.price-card-historial').addEventListener('click', (e) => { e.stopPropagation(); abrirHistorico(material.material, entry.estado); });
    return card;
}

function actualizarTablaDashboard(paginaDatos) {
    const tableBody = document.getElementById('priceTableBody');
    tableBody.innerHTML = '';
    paginaDatos.forEach(entry => {
        const material = materiales.find(m => m.id === entry.material_id);
        if (!material) return;
        const precioProm = entry.sumaPV / entry.sumaV;
        const precioMin = Math.min(...entry.precios);
        const precioMax = Math.max(...entry.precios);
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${material.material}</strong></td><td>${material.presentacion}</td><td>${material.origen}</td><td>${material.color}</td>
            <td>${entry.estado}</td><td><span class="price-card-badge ${entry.tipo_operacion === 'Compra' ? 'badge-compra' : 'badge-venta'}">${entry.tipo_operacion}</span></td>
            <td><strong>$${precioProm.toFixed(2)}</strong></td><td>$${precioMin.toFixed(2)} - $${precioMax.toFixed(2)}</td><td>${entry.count}</td>
            <td><span class="${entry.todosVerificados ? 'calidad-verificada' : 'calidad-atipica'}">${entry.todosVerificados ? '✅' : '⚠️'}</span></td>
            <td><span class="btn-ver" data-material="${material.material}" data-estado="${entry.estado}">📈</span></td>
        `;
        tableBody.appendChild(row);
        row.querySelector('.btn-ver').addEventListener('click', () => abrirHistorico(material.material, entry.estado));
    });
}
document.getElementById('btnApplyFilters').addEventListener('click', mostrarDashboard);

// ==================== GRÁFICO HISTÓRICO ====================
function abrirHistorico(materialNombre, estado) {
    document.getElementById('modalHistorico').style.display = 'flex';
    document.getElementById('historicoTitle').textContent = `Histórico: ${materialNombre} en ${estado}`;
    const ctx = document.getElementById('chartHistorico').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    const materialIds = materiales.filter(m => m.material === materialNombre).map(m => m.id);
    const historico = reportes.filter(r => materialIds.includes(r.material_id) && r.estado === estado);
    if (historico.length === 0) {
        document.getElementById('chartHistorico').style.display = 'none';
        document.getElementById('historicoTitle').insertAdjacentHTML('afterend', '<p style="text-align:center;margin-top:20px;">No hay datos históricos para este material y estado.</p>');
        return;
    }
    document.getElementById('chartHistorico').style.display = 'block';
    const agrupado = {};
    historico.forEach(r => {
        const mes = r.fecha.substring(0, 7);
        if (!agrupado[mes]) agrupado[mes] = { sumaPV: 0, sumaV: 0 };
        const vol = r.volumen_ton || 1;
        agrupado[mes].sumaPV += r.precio_kg * vol;
        agrupado[mes].sumaV += vol;
    });
    const mesesOrdenados = Object.keys(agrupado).sort();
    const labels = mesesOrdenados.map(m => {
        const [year, month] = m.split('-');
        const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        return `${mesesNombres[parseInt(month)-1]} ${year.slice(2)}`;
    });
    const precios = mesesOrdenados.map(m => agrupado[m].sumaPV / agrupado[m].sumaV);
    chartInstance = new Chart(ctx, {
        type: 'line', data: { labels, datasets: [{ label: `Precio promedio ${materialNombre} en ${estado}`, data: precios, borderColor: '#1a56db', backgroundColor: 'rgba(26,86,219,0.1)', fill: true, tension: 0.4, pointRadius: 5 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: false, title: { display: true, text: 'MXN/kg' } } } }
    });
    document.getElementById('closeHistorico').onclick = () => { document.getElementById('modalHistorico').style.display = 'none'; };
}

// ==================== PANEL DE REPORTE ====================
function mostrarPanelReporte() {
    const accessMsg = document.getElementById('reportAccessMessage');
    const form = document.getElementById('formReporte');
    document.getElementById('reportResult').style.display = 'none';
    if (!currentUser) {
        accessMsg.innerHTML = '<p>🔒 Para reportar precios necesitas acceder.</p><button class="btn btn-primary" onclick="abrirModalAuth()" style="margin-top:16px;">Acceder / Registrarme</button>';
        form.style.display = 'none';
    } else {
        accessMsg.innerHTML = `<p style="color:var(--success);">✅ Has accedido como <strong>${currentUser.nombre}</strong> (${currentUser.tipo || 'Usuario'}) · 🏅 Insignia: ${obtenerInsignia(currentUser.nombre)}</p>`;
        form.style.display = 'flex';
    }
}

function obtenerInsignia(nombre) {
    const count = reportes.filter(r => r.usuario === nombre && r.fecha >= new Date(Date.now() - 30*86400000).toISOString().split('T')[0]).length;
    if (count >= 10) return '🥇 Oro'; if (count >= 5) return '🥈 Plata'; if (count >= 3) return '🥉 Bronce'; return '🌱 Nuevo';
}

async function configurarFormularioReporte() {
    document.getElementById('formReporte').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) { showToast('Debes iniciar sesión.', 'error'); return; }
        const materialId = parseInt(document.getElementById('material').value);
        const precio = parseFloat(document.getElementById('precioKg').value);
        const estado = document.getElementById('estado').value;
        const hoy = new Date().toISOString().split('T')[0];
        const analisis = analizarPrecio(precio, materialId, estado);
        let verificado = !analisis.esAtipico;
        if (analisis.nivel === 'critico') {
            const confirmado = await confirmModal(analisis.mensaje + '\n\n¿Deseas reportar este precio de todos modos? Se marcará como atípico.');
            if (!confirmado) return;
            verificado = false;
        }
        const nuevoReporte = {
            material_id: materialId,
            precio_kg: precio,
            estado,
            municipio: document.getElementById('municipio').value || 'No especificado',
            volumen_ton: parseFloat(document.getElementById('volumenTon').value) || 1,
            tipo_operacion: document.getElementById('tipoOperacion').value,
            contaminacion: document.getElementById('contaminacion').value || 'No especificado',
            fecha: hoy,
            verificado
        };
        try {
            await apiFetch(`${API_URL}/reportes`, { method: 'POST', body: JSON.stringify(nuevoReporte) });
            showToast('✅ ¡Reporte Registrado!', 'success');
            reportes = await apiFetch(`${API_URL}/reportes`);
            mostrarDashboard();
            mostrarRanking();
            actualizarIndicadorConfianza();
            dispararNotificacionesAlerta({ material_id: materialId, precio_kg: precio, estado });
            document.getElementById('formReporte').style.display = 'none';
            const res = document.getElementById('reportResult'); res.style.display = 'block';
            const zona = reportes.filter(r => r.material_id === materialId && r.estado === estado && r.fecha >= new Date(Date.now() - 30*86400000).toISOString().split('T')[0] && r.verificado);
            let spv = 0, sv = 0; zona.forEach(r => { const v = r.volumen_ton || 1; spv += r.precio_kg * v; sv += v; });
            const prom = sv > 0 ? (spv / sv).toFixed(2) : precio.toFixed(2);
            const mat = materiales.find(m => m.id === materialId);
            res.innerHTML = `
                <h3>✅ ¡Reporte Registrado!</h3>
                <p>${nuevoReporte.tipo_operacion} de <strong>${mat?.material || 'Material'} ${mat?.color || ''}</strong> en ${estado}: <strong>$${precio.toFixed(2)}/kg</strong>.</p>
                ${!verificado ? '<p style="color:var(--danger); margin-top:8px;">⚠️ Este reporte fue marcado como atípico y no se incluye en el promedio general.</p>' : ''}
                <div style="margin-top:16px;padding:16px;background:white;border-radius:8px;">
                    <p style="font-weight:700;color:var(--primary);">📊 Promedio de tu zona (30 días, verificados):</p>
                    <p style="font-size:2rem;font-weight:800;color:var(--success);">$${prom} MXN/kg</p><p style="color:var(--gray-500);">${zona.length} reportes verificados</p>
                </div>
                <button class="btn btn-primary" onclick="nuevoReporte()" style="margin-top:16px;">Reportar otro</button>
                <button class="btn btn-ghost" onclick="irAlDashboard()">Ver precios</button>
            `;
        } catch (error) {
            showToast('Error al guardar el reporte: ' + error.message, 'error');
        }
    });
}

function nuevoReporte() { document.getElementById('formReporte').style.display = 'flex'; document.getElementById('formReporte').reset(); document.getElementById('reportResult').style.display = 'none'; document.getElementById('precioWarning').style.display = 'none'; }
function irAlDashboard() {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector('[data-panel="dashboard"]').classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-dashboard').classList.add('active');
    mostrarDashboard();
    cargarAnuncios('dashboard');
}

// ==================== RANKING ====================
function mostrarRanking() {
    const hace30 = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
    const conteo = {};
    reportes.filter(r => r.fecha >= hace30 && r.verificado === true).forEach(r => { const alias = r.usuario.charAt(0).toUpperCase() + '****'; conteo[alias] = (conteo[alias] || 0) + 1; });
    const ranking = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const container = document.getElementById('rankingList'); container.innerHTML = '';
    if (ranking.length === 0) { container.innerHTML = '<p style="text-align:center;color:var(--gray-400);">Aún no hay reportes verificados este mes. ¡Sé el primero!</p>'; return; }
    const insignias = ['🥇', '🥈', '🥉', '⭐', '⭐']; const clases = ['gold', 'silver', 'bronze', '', ''];
    ranking.forEach(([nombre, count], i) => {
        const div = document.createElement('div'); div.className = 'ranking-item';
        div.innerHTML = `<div class="ranking-pos ${clases[i]}">${insignias[i]}</div><div class="ranking-info"><div class="ranking-nombre">${nombre}</div><div class="ranking-estado">Acopiador verificado</div></div><div class="ranking-reportes">${count} reportes</div>`;
        container.appendChild(div);
    });
}

// ==================== ALERTAS ====================
function configurarFormularioAlerta() {
    document.getElementById('formAlerta').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) { showToast('Debes iniciar sesión.', 'error'); return; }
        const nueva = {
            material_id: parseInt(document.getElementById('alertaMaterial').value),
            estado: document.getElementById('alertaEstado').value,
            precio_objetivo: parseFloat(document.getElementById('alertaPrecio').value),
            condicion: document.getElementById('alertaCondicion').value
        };
        try {
            await apiFetch(`${API_URL}/alertas`, { method: 'POST', body: JSON.stringify(nueva) });
            alertas = await apiFetch(`${API_URL}/alertas`);
            mostrarAlertas();
            document.getElementById('formAlerta').reset();
            showToast('Alerta creada correctamente.', 'success');
        } catch (error) {
            showToast('Error al crear alerta: ' + error.message, 'error');
        }
    });
}

function mostrarAlertas() {
    const accessMsg = document.getElementById('alertasAccessMessage');
    const form = document.getElementById('formAlerta');
    const list = document.getElementById('alertasList');
    if (!currentUser) { accessMsg.innerHTML = '<p>🔒 Inicia sesión para crear alertas de precio.</p>'; form.style.display = 'none'; list.innerHTML = ''; return; }
    accessMsg.innerHTML = '';
    form.style.display = 'flex';
    if (alertas.length === 0) { list.innerHTML = '<p style="text-align:center;color:var(--gray-400);">No tienes alertas configuradas.</p>'; return; }
    list.innerHTML = alertas.map(a => {
        const mat = materiales.find(m => m.id === a.material_id);
        return `<div class="alerta-item"><div class="alerta-info"><div class="alerta-material">${mat ? mat.material : 'Material'} en ${a.estado}</div><div class="alerta-detalle">Cuando ${a.condicion === 'debajo' ? 'baje' : 'suba'} de $${a.precio_objetivo.toFixed(2)}/kg ${a.activa ? '' : '(Desactivada)'}</div></div><button class="alerta-delete" data-id="${a.id}">🗑 Eliminar</button></div>`;
    }).join('');
    document.querySelectorAll('.alerta-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = parseInt(btn.dataset.id);
            try {
                await apiFetch(`${API_URL}/alertas/${id}`, { method: 'DELETE' });
                alertas = await apiFetch(`${API_URL}/alertas`);
                mostrarAlertas();
            } catch (error) {
                showToast('Error al eliminar alerta', 'error');
            }
        });
    });
}

// ==================== MODALS ====================
function configurarModals() {
    document.getElementById('closeModal').addEventListener('click', () => document.getElementById('modalAuth').style.display = 'none');
    document.getElementById('closeHistorico').addEventListener('click', () => document.getElementById('modalHistorico').style.display = 'none');
    document.getElementById('closeNewsletter').addEventListener('click', () => document.getElementById('modalNewsletter').style.display = 'none');
    document.getElementById('formNewsletter').addEventListener('submit', (e) => { e.preventDefault(); showToast('✅ ¡Suscripción exitosa!', 'success'); document.getElementById('modalNewsletter').style.display = 'none'; });
    document.getElementById('closeContacto').addEventListener('click', cerrarModalContacto);
    document.getElementById('closeCalificar').addEventListener('click', () => document.getElementById('modalCalificar').style.display = 'none');
    document.getElementById('closeReportar').addEventListener('click', () => document.getElementById('modalReportar').style.display = 'none');
    document.getElementById('closeFoto').addEventListener('click', () => document.getElementById('modalFoto').style.display = 'none');
    document.getElementById('closeOferta').addEventListener('click', () => document.getElementById('modalOferta').style.display = 'none');
    window.addEventListener('click', (e) => { if (e.target.classList.contains('modal')) e.target.style.display = 'none'; });
}
function abrirModalAuth() { document.getElementById('modalAuth').style.display = 'flex'; }
function abrirNewsletter() { document.getElementById('modalNewsletter').style.display = 'flex'; }
function cerrarModalContacto() { document.getElementById('modalContacto').style.display = 'none'; }

// ==================== AUTENTICACIÓN (UI) ====================
function configurarAuth() {
    const tabs = document.querySelectorAll('.auth-tab');
    tabs.forEach(tab => { tab.addEventListener('click', () => { tabs.forEach(t => t.classList.remove('active')); tab.classList.add('active'); const target = tab.dataset.tab; document.getElementById('formLogin').style.display = target === 'login' ? 'flex' : 'none'; document.getElementById('formRegistro').style.display = target === 'registro' ? 'flex' : 'none'; }); });
    document.getElementById('formLogin').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;
        const success = await login(email, password);
        if (success) {
            document.getElementById('modalAuth').style.display = 'none';
            actualizarUIUsuario();
            mostrarPanelReporte();
            mostrarAlertas();
            await cargarDatosUsuario();
            mostrarMarketplace();
            showToast(`Bienvenido de nuevo, ${currentUser.nombre}.`, 'success');
        }
    });
    document.getElementById('formRegistro').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nombre = document.getElementById('regNombre').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const password = document.getElementById('regPassword').value;
        const tipo = document.getElementById('regTipo').value;
        const estado = document.getElementById('regEstado').value;
        const success = await registro(nombre, email, password, tipo, estado);
        if (success) {
            document.getElementById('modalAuth').style.display = 'none';
            actualizarUIUsuario();
            mostrarPanelReporte();
            mostrarAlertas();
            await cargarDatosUsuario();
            mostrarMarketplace();
            showToast('✅ Cuenta creada exitosamente. ¡Bienvenido!', 'success');
        }
    });
}

// ==================== FOTO PREVIEW ====================
function configurarFotoPreview() {
    document.getElementById('mkFoto').addEventListener('change', function(e) {
        const file = e.target.files[0]; const preview = document.getElementById('mkFotoPreview');
        if (file) { const reader = new FileReader(); reader.onload = function(ev) { preview.src = ev.target.result; preview.style.display = 'block'; }; reader.readAsDataURL(file); }
        else { preview.src = '#'; preview.style.display = 'none'; }
    });
}

// ==================== MARKETPLACE CON PAGINACIÓN ====================
let marketplacePaginaActual = 1;
let marketplaceDatosFiltrados = [];

function configurarMarketplace() {
    const tabs = document.querySelectorAll('.mk-tab');
    tabs.forEach(tab => { tab.addEventListener('click', function() { tabs.forEach(t => t.classList.remove('active')); this.classList.add('active'); const tipo = this.dataset.mktab; const filtroOp = document.getElementById('mkFilterOperacion'); if (tipo === 'todas') filtroOp.value = 'todos'; else if (tipo === 'ventas') filtroOp.value = 'Venta'; else if (tipo === 'compras') filtroOp.value = 'Compra'; mostrarMarketplace(); }); });
    document.getElementById('formMarketplace').addEventListener('submit', async (e) => {
        e.preventDefault(); if (!currentUser) { showToast('Debes iniciar sesión.', 'error'); return; }
        const editId = document.getElementById('mkEditId').value;
        const formData = {
            tipo: document.getElementById('mkTipo').value,
            material_id: parseInt(document.getElementById('mkMaterial').value),
            presentacion: document.getElementById('mkPresentacion').value || 'No especificado',
            origen: document.getElementById('mkOrigen').value || 'No especificado',
            color: document.getElementById('mkColor').value || 'No especificado',
            precio_kg: parseFloat(document.getElementById('mkPrecio').value) || 0,
            volumen_ton: parseFloat(document.getElementById('mkVolumen').value) || 0,
            estado: document.getElementById('mkEstado').value,
            municipio: document.getElementById('mkMunicipio').value || 'No especificado',
            garantia: document.getElementById('mkGarantia').value,
            descripcion: document.getElementById('mkDescripcion').value || '',
        };
        const fotoInput = document.getElementById('mkFoto');
        const procesar = async (fotoData) => {
            const datos = { ...formData, foto: fotoData, es_atipico: false };
            try {
                if (editId) {
                    await apiFetch(`${API_URL}/marketplace/${editId}`, { method: 'PUT', body: JSON.stringify(datos) });
                    showToast('Publicación actualizada.', 'success');
                } else {
                    await apiFetch(`${API_URL}/marketplace`, { method: 'POST', body: JSON.stringify(datos) });
                    showToast('Publicación creada.', 'success');
                }
                publicacionesMK = await apiFetch(`${API_URL}/marketplace`);
                mostrarMarketplace();
                cancelarPublicacion();
                mostrarCuenta();
            } catch (error) {
                showToast('Error: ' + error.message, 'error');
            }
        };
        if (fotoInput.files.length > 0) {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                try {
                    const uploadRes = await apiFetch(`${API_URL}/upload`, { method: 'POST', body: JSON.stringify({ image: ev.target.result }) });
                    procesar(uploadRes.url);
                } catch (err) {
                    showToast('Error al subir imagen', 'error');
                }
            };
            reader.readAsDataURL(fotoInput.files[0]);
        } else {
            procesar(null);
        }
    });
    document.getElementById('btnApplyMkFilters').addEventListener('click', mostrarMarketplace);
}

function mostrarFormularioPublicacion() {
    if (!currentUser) { abrirModalAuth(); return; }
    document.getElementById('mkEditId').value = '';
    document.getElementById('btnSubmitMK').textContent = '📢 Publicar';
    document.getElementById('formMarketplace').reset();
    document.getElementById('mkFotoPreview').style.display = 'none';
    document.getElementById('mkPrecioWarning').style.display = 'none';
    document.getElementById('formMarketplace').style.display = 'flex';
    document.getElementById('btnPublicarMarketplace').style.display = 'none';
}

function editarPublicacion(id) {
    const pub = publicacionesMK.find(p => p.id == id);
    if (!pub) return;
    document.getElementById('mkEditId').value = pub.id;
    document.getElementById('btnSubmitMK').textContent = '💾 Guardar cambios';
    document.getElementById('mkTipo').value = pub.tipo;
    document.getElementById('mkMaterial').value = pub.material_id;
    document.getElementById('mkPresentacion').value = pub.presentacion;
    document.getElementById('mkOrigen').value = pub.origen;
    document.getElementById('mkColor').value = pub.color;
    document.getElementById('mkPrecio').value = pub.precio_kg;
    document.getElementById('mkVolumen').value = pub.volumen_ton;
    document.getElementById('mkEstado').value = pub.estado;
    document.getElementById('mkMunicipio').value = pub.municipio;
    document.getElementById('mkGarantia').value = pub.garantia;
    document.getElementById('mkDescripcion').value = pub.descripcion;
    const preview = document.getElementById('mkFotoPreview');
    if (pub.foto) { preview.src = pub.foto; preview.style.display = 'block'; }
    else { preview.src = '#'; preview.style.display = 'none'; }
    document.getElementById('formMarketplace').style.display = 'flex';
    document.getElementById('btnPublicarMarketplace').style.display = 'none';
    document.getElementById('formMarketplace').scrollIntoView({ behavior: 'smooth' });
}

async function eliminarPublicacion(id) {
    const confirmado = await confirmModal('¿Eliminar publicación?');
    if (confirmado) {
        try {
            await apiFetch(`${API_URL}/marketplace/${id}`, { method: 'DELETE' });
            publicacionesMK = await apiFetch(`${API_URL}/marketplace`);
            mostrarMarketplace();
            mostrarCuenta();
            showToast('Publicación eliminada.', 'info');
        } catch (error) {
            showToast('Error al eliminar.', 'error');
        }
    }
}

function cancelarPublicacion() {
    document.getElementById('formMarketplace').style.display = 'none';
    document.getElementById('formMarketplace').reset();
    document.getElementById('mkFotoPreview').style.display = 'none';
    document.getElementById('mkPrecioWarning').style.display = 'none';
    if (currentUser) document.getElementById('btnPublicarMarketplace').style.display = 'inline-flex';
}

function mostrarMarketplace(resetPage = true) {
    if (resetPage) marketplacePaginaActual = 1;
    const accessMsg = document.getElementById('marketplaceAccess'); const btnPublicar = document.getElementById('btnPublicarMarketplace'); const filters = document.getElementById('mkFilters'); const searchSort = document.getElementById('mkSearchSort');
    const tabsContainer = document.getElementById('mkTabs'); const lista = document.getElementById('marketplaceList'); const tabMsg = document.getElementById('mkTabMessage');
    if (!currentUser) { accessMsg.innerHTML = '<p>🔒 Inicia sesión para ver y publicar.</p><button class="btn btn-primary" onclick="abrirModalAuth()">Acceder</button>'; btnPublicar.style.display = 'none'; filters.style.display = 'none'; searchSort.style.display = 'none'; tabsContainer.style.display = 'none'; lista.innerHTML = ''; return; }
    accessMsg.innerHTML = ''; btnPublicar.style.display = 'inline-flex'; filters.style.display = 'flex'; searchSort.style.display = 'flex'; tabsContainer.style.display = 'flex';
    const activeTab = document.querySelector('.mk-tab.active'); const filtroOp = document.getElementById('mkFilterOperacion');
    if (activeTab) { const tipo = activeTab.dataset.mktab; if (tipo === 'todas') { filtroOp.value = 'todos'; tabMsg.style.display = 'none'; } else if (tipo === 'ventas') { filtroOp.value = 'Venta'; tabMsg.style.display = 'none'; } else if (tipo === 'compras') { filtroOp.value = 'Compra'; tabMsg.style.display = 'block'; tabMsg.textContent = '🛒 Estas publicaciones son de compradores buscando material. El precio indicado es lo que están dispuestos a pagar.'; } }
    const matFilter = document.getElementById('mkFilterMaterial').value; const estFilter = document.getElementById('mkFilterEstado').value; const opFilter = filtroOp.value;
    const searchTerm = document.getElementById('searchMarketplace')?.value?.toLowerCase() || '';
    let filtradas = publicacionesMK.filter(p => p.activo); if (matFilter !== 'todos') filtradas = filtradas.filter(p => p.material_id == matFilter); if (estFilter !== 'todos') filtradas = filtradas.filter(p => p.estado === estFilter); if (opFilter !== 'todos') filtradas = filtradas.filter(p => p.tipo === opFilter);
    if (searchTerm) {
        filtradas = filtradas.filter(p => {
            const mat = materiales.find(m => m.id === p.material_id);
            return (mat && (mat.material.toLowerCase().includes(searchTerm) || mat.color.toLowerCase().includes(searchTerm))) || p.estado.toLowerCase().includes(searchTerm) || p.descripcion.toLowerCase().includes(searchTerm) || p.usuario_nombre.toLowerCase().includes(searchTerm);
        });
    }
    const sortValue = document.getElementById('sortMarketplace')?.value || '';
    if (sortValue === 'fecha-desc') filtradas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    else if (sortValue === 'fecha-asc') filtradas.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    else if (sortValue === 'precio-asc') filtradas.sort((a, b) => (a.precio_kg || 0) - (b.precio_kg || 0));
    else if (sortValue === 'precio-desc') filtradas.sort((a, b) => (b.precio_kg || 0) - (a.precio_kg || 0));

    marketplaceDatosFiltrados = filtradas;
    const totalPaginas = Math.ceil(filtradas.length / ITEMS_POR_PAGINA);
    const inicio = (marketplacePaginaActual - 1) * ITEMS_POR_PAGINA;
    const paginaDatos = filtradas.slice(inicio, inicio + ITEMS_POR_PAGINA);

    lista.innerHTML = '';
    if (paginaDatos.length === 0) { lista.innerHTML = '<p style="text-align:center;color:var(--gray-400);grid-column:1/-1;">No hay publicaciones.</p>'; }
    else {
        const fragment = document.createDocumentFragment();
        paginaDatos.forEach(pub => fragment.appendChild(crearTarjetaMarketplace(pub)));
        lista.appendChild(fragment);
    }
    const btnLoadMore = document.getElementById('btnLoadMoreMarketplace');
    if (btnLoadMore) btnLoadMore.style.display = marketplacePaginaActual < totalPaginas ? 'inline-block' : 'none';
}

function crearTarjetaMarketplace(pub) {
    const mat = materiales.find(m => m.id === pub.material_id);
    const avgRating = obtenerPromedioCalificacion(pub.usuario_email);
    const numReports = reportesVendedor.filter(r => r.reportedEmail === pub.usuario_email).length;
    const confianza = obtenerConfianzaVendedor(pub.usuario_email);
    const card = document.createElement('div');
    card.className = `mk-card ${pub.tipo === 'Compra' ? 'compra' : ''} ${pub.es_atipico ? 'atipico' : ''}`;
    let fotoHTML = ''; if (pub.foto) fotoHTML = `<img src="${pub.foto}" class="mk-foto" alt="Foto del material" onclick="mostrarFoto('${pub.foto}')">`;
    let ratingHTML = ''; if (avgRating > 0) ratingHTML = `<div class="rating-summary"><span class="stars">${'★'.repeat(Math.round(avgRating))}${'☆'.repeat(5-Math.round(avgRating))}</span><span style="font-size:0.8rem;">${avgRating.toFixed(1)}</span></div>`;
    let reportWarning = ''; if (numReports >= 2) reportWarning = '<span class="report-warning">⚠️ Usuario con reportes</span>';
    let confianzaHTML = `<span class="trust-score ${confianza.nivel}">🛡️ ${confianza.label}</span>`;
    let precioHTML = ''; if (pub.precio_kg > 0) { if (pub.tipo === 'Compra') precioHTML = `<div class="mk-card-precio pago"><div class="mk-card-pago-label">💰 Precio que pago:</div>$${pub.precio_kg.toFixed(2)} MXN/kg</div>`; else precioHTML = `<div class="mk-card-precio">$${pub.precio_kg.toFixed(2)} MXN/kg ${pub.es_atipico ? '<span class="badge-atipico">Atípico</span>' : ''}</div>`; } else precioHTML = '<div class="mk-card-precio">Precio no especificado</div>';
    let ofertaBtnHTML = ''; if (pub.tipo === 'Compra' && currentUser.email !== pub.usuario_email) { const yaEnvio = ofertas.some(o => o.publicacion_id == pub.id && o.vendedor_email === currentUser.email); if (yaEnvio) ofertaBtnHTML = '<span style="font-size:0.7rem;color:var(--success);">✓ Oferta enviada</span>'; else ofertaBtnHTML = `<button class="btn-oferta" data-id="${pub.id}" data-comprador="${pub.usuario_email}">💡 Hacer oferta</button>`; }
    card.innerHTML = `${fotoHTML}<div class="mk-card-header"><span class="mk-card-tipo ${pub.tipo === 'Compra' ? 'badge-compra' : 'badge-venta'}">${pub.tipo}</span><span style="font-size:0.8rem;">${new Date(pub.fecha).toLocaleDateString()}</span></div><div class="mk-card-material">${mat ? mat.material : 'Material'}</div><div class="mk-card-detalle">${mat ? mat.presentacion + ' · ' + mat.color + ' · ' + mat.origen : ''}<br>${pub.presentacion} · ${pub.color} · ${pub.origen}<br>📍 ${pub.estado}, ${pub.municipio}<br>📦 ${pub.volumen_ton} ton<br>🔒 Garantía: ${pub.garantia}<br>${pub.descripcion ? '📝 ' + pub.descripcion : ''}</div>${precioHTML}${ratingHTML}${confianzaHTML}${reportWarning}<div class="mk-card-footer"><span>${pub.usuario_nombre}</span><div style="display:flex; gap:8px;"><button class="btn-contactar" data-id="${pub.id}">📩 Contactar</button>${currentUser.email !== pub.usuario_email ? `<button class="btn-contactar" onclick="abrirCalificar('${pub.usuario_email}')">⭐</button>` : ''}${ofertaBtnHTML}</div></div>`;
    card.querySelector('.btn-contactar').addEventListener('click', () => abrirContacto(pub));
    const btnOferta = card.querySelector('.btn-oferta'); if (btnOferta) btnOferta.addEventListener('click', () => abrirModalOferta(btnOferta.dataset.id, btnOferta.dataset.comprador));
    return card;
}

function abrirContacto(pub) {
    const modal = document.getElementById('modalContacto');
    const detalle = document.getElementById('contactoDetalle');
    const mat = materiales.find(m => m.id === pub.material_id);
    const avgRating = obtenerPromedioCalificacion(pub.usuario_email);
    const confianza = obtenerConfianzaVendedor(pub.usuario_email);
    detalle.innerHTML = `<p><strong>${pub.tipo} de ${mat ? mat.material : 'material'}</strong></p><p>Publicado por: ${pub.usuario_nombre} (${pub.usuario_email})</p><p>Precio: ${pub.precio_kg > 0 ? '$'+pub.precio_kg.toFixed(2)+'/kg' : 'No especificado'}</p>${pub.foto ? `<img src="${pub.foto}" style="max-width:200px; border-radius:8px; margin:10px 0;">` : ''}<p><strong>Calificación promedio:</strong> ${avgRating > 0 ? '★'.repeat(Math.round(avgRating)) + ' ' + avgRating.toFixed(1) : 'Sin calificaciones'}</p><p><strong>Confianza del vendedor:</strong> <span class="trust-score ${confianza.nivel}">🛡️ ${confianza.label}</span></p>${pub.es_atipico ? '<p style="color:var(--danger);">⚠️ Este precio fue marcado como atípico.</p>' : ''}<a href="https://wa.me/5210000000000?text=Hola, vi tu publicación en PrecioMolido.mx sobre ${mat?mat.material:'material'} en ${pub.estado}" class="whatsapp-link" target="_blank">💬 Contactar por WhatsApp</a><div style="margin-top:16px; display:flex; gap:10px; justify-content:center;">${currentUser.email !== pub.usuario_email ? `<button class="btn btn-sm btn-primary" onclick="abrirCalificar('${pub.usuario_email}')">⭐ Calificar</button><button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="abrirReportar('${pub.usuario_email}')">🚩 Reportar</button>` : ''}</div>`;
    modal.style.display = 'flex';
}

// ==================== OFERTAS ====================
function configurarOfertas() {
    document.getElementById('formOferta').addEventListener('submit', async (e) => {
        e.preventDefault(); if (!currentUser) { showToast('Debes iniciar sesión.', 'error'); return; }
        const publicacionId = parseInt(document.getElementById('ofertaPublicacionId').value);
        const compradorEmail = document.getElementById('ofertaCompradorEmail').value;
        const precio = parseFloat(document.getElementById('ofertaPrecio').value);
        const volumen = parseFloat(document.getElementById('ofertaVolumen').value) || 0;
        const mensaje = document.getElementById('ofertaMensaje').value;
        try {
            await apiFetch(`${API_URL}/ofertas`, { method: 'POST', body: JSON.stringify({ publicacionId, compradorEmail, precio, volumen, mensaje }) });
            document.getElementById('modalOferta').style.display = 'none';
            document.getElementById('formOferta').reset();
            showToast('✅ Oferta enviada correctamente.', 'success');
            await cargarDatosUsuario();
            mostrarMarketplace();
            mostrarCuenta();
        } catch (error) {
            showToast('Error al enviar oferta: ' + error.message, 'error');
        }
    });
}

function abrirModalOferta(publicacionId, compradorEmail) {
    if (!currentUser) { abrirModalAuth(); return; }
    document.getElementById('ofertaPublicacionId').value = publicacionId;
    document.getElementById('ofertaCompradorEmail').value = compradorEmail;
    document.getElementById('modalOferta').style.display = 'flex';
}

async function aceptarOferta(ofertaId) {
    try {
        await apiFetch(`${API_URL}/ofertas/${ofertaId}/aceptar`, { method: 'PUT' });
        await cargarDatosUsuario();
        mostrarCuenta();
        mostrarMarketplace();
        showToast('✅ Oferta aceptada.', 'success');
    } catch (e) { showToast('Error al aceptar oferta', 'error'); }
}

async function rechazarOferta(ofertaId) {
    try {
        await apiFetch(`${API_URL}/ofertas/${ofertaId}/rechazar`, { method: 'PUT' });
        await cargarDatosUsuario();
        mostrarCuenta();
        showToast('❌ Oferta rechazada.', 'info');
    } catch (e) { showToast('Error al rechazar oferta', 'error'); }
}

// ==================== CALIFICACIONES ====================
function configurarCalificaciones() {
    const stars = document.querySelectorAll('.star');
    let selectedRating = 0;
    stars.forEach(star => {
        star.addEventListener('click', function() { selectedRating = parseInt(this.dataset.value); document.getElementById('calificarPuntuacion').value = selectedRating; stars.forEach(s => s.classList.remove('active')); for (let i = 0; i < selectedRating; i++) stars[i].classList.add('active'); });
        star.addEventListener('mouseenter', function() { const value = parseInt(this.dataset.value); stars.forEach(s => s.classList.remove('hover')); for (let i = 0; i < value; i++) stars[i].classList.add('hover'); });
        star.addEventListener('mouseleave', function() { stars.forEach(s => s.classList.remove('hover')); stars.forEach(s => s.classList.remove('active')); for (let i = 0; i < selectedRating; i++) stars[i].classList.add('active'); });
    });
    document.getElementById('formCalificar').addEventListener('submit', async (e) => {
        e.preventDefault();
        const toEmail = document.getElementById('calificarEmail').value;
        const rating = parseInt(document.getElementById('calificarPuntuacion').value);
        const comment = document.getElementById('calificarComentario').value;
        if (rating === 0) { showToast('Selecciona una puntuación.', 'warning'); return; }
        try {
            await apiFetch(`${API_URL}/calificaciones`, { method: 'POST', body: JSON.stringify({ toEmail, rating, comment }) });
            document.getElementById('modalCalificar').style.display = 'none';
            showToast('Calificación enviada.', 'success');
            calificaciones = await apiFetch(`${API_URL}/calificaciones/todas`).catch(() => calificaciones);
            mostrarMarketplace();
            mostrarCuenta();
        } catch (error) { showToast('Error al enviar calificación: ' + error.message, 'error'); }
    });
}

function abrirCalificar(email) {
    if (!currentUser) { abrirModalAuth(); return; }
    document.getElementById('calificarEmail').value = email;
    document.getElementById('calificarPuntuacion').value = 0;
    document.getElementById('calificarComentario').value = '';
    document.querySelectorAll('.star').forEach(s => s.classList.remove('active'));
    document.getElementById('modalCalificar').style.display = 'flex';
}

function obtenerPromedioCalificacion(email) {
    const cals = calificaciones.filter(c => c.to_email === email);
    if (cals.length === 0) return 0;
    const sum = cals.reduce((acc, c) => acc + c.rating, 0);
    return sum / cals.length;
}

// ==================== REPORTES DE VENDEDORES ====================
function configurarReportes() {
    document.getElementById('formReportarVendedor').addEventListener('submit', async (e) => {
        e.preventDefault();
        const reportedEmail = document.getElementById('reportarEmail').value;
        const motivo = document.getElementById('reportarMotivo').value;
        const descripcion = document.getElementById('reportarDescripcion').value;
        try {
            await apiFetch(`${API_URL}/reportes-vendedor`, { method: 'POST', body: JSON.stringify({ reportedEmail, motivo, descripcion }) });
            document.getElementById('modalReportar').style.display = 'none';
            showToast('Reporte enviado. Gracias por ayudarnos a mantener la comunidad segura.', 'success');
            reportesVendedor = await apiFetch(`${API_URL}/reportes-vendedor`).catch(() => []);
            mostrarMarketplace();
            mostrarCuenta();
        } catch (error) { showToast('Error al enviar reporte: ' + error.message, 'error'); }
    });
}

function abrirReportar(email) {
    if (!currentUser) { abrirModalAuth(); return; }
    document.getElementById('reportarEmail').value = email;
    document.getElementById('reportarMotivo').value = '';
    document.getElementById('reportarDescripcion').value = '';
    document.getElementById('modalReportar').style.display = 'flex';
}

// ==================== FOTO AMPLIADA ====================
function mostrarFoto(src) { document.getElementById('fotoAmpliada').src = src; document.getElementById('modalFoto').style.display = 'flex'; }

// ==================== MI CUENTA ====================
function mostrarCuenta() {
    const panel = document.getElementById('cuentaContent');
    if (!currentUser) { panel.innerHTML = '<p style="text-align:center;color:var(--gray-400);padding:40px;">Inicia sesión para ver tu cuenta.</p>'; return; }
    const misReportes = reportes.filter(r => r.usuario === currentUser.nombre);
    const misPublicaciones = publicacionesMK.filter(p => p.usuario_email === currentUser.email);
    const misAlertas = alertas;
    const misCalificaciones = calificaciones.filter(c => c.to_email === currentUser.email);
    const avgRating = obtenerPromedioCalificacion(currentUser.email);
    const numReports = reportesVendedor.filter(r => r.reportedEmail === currentUser.email).length;
    const confianza = obtenerConfianzaVendedor(currentUser.email);
    const ofertasRecibidas = ofertas.filter(o => o.comprador_email === currentUser.email);
    const ofertasEnviadas = ofertas.filter(o => o.vendedor_email === currentUser.email);
    panel.innerHTML = `
        <div class="cuenta-section">
            <h3>📋 Perfil</h3>
            <div class="cuenta-grid">
                <div class="cuenta-dato"><strong>Nombre:</strong> ${currentUser.nombre}</div>
                <div class="cuenta-dato"><strong>Email:</strong> ${currentUser.email}</div>
                <div class="cuenta-dato"><strong>Tipo:</strong> ${currentUser.tipo || 'No especificado'}</div>
                <div class="cuenta-dato"><strong>Estado:</strong> ${currentUser.estado || 'No especificado'}</div>
            </div>
            <p><span class="cuenta-badge badge-compra">${obtenerInsignia(currentUser.nombre)}</span></p>
            <p><span class="trust-score ${confianza.nivel}">🛡️ Confianza: ${confianza.label}</span></p>
            ${avgRating > 0 ? `<p>⭐ Calificación: ${'★'.repeat(Math.round(avgRating))} ${avgRating.toFixed(1)} (${misCalificaciones.length} calificaciones)</p>` : '<p>Sin calificaciones aún.</p>'}
            ${numReports > 0 ? `<p class="report-warning">⚠️ Tienes ${numReports} reporte(s) de otros usuarios.</p>` : ''}
        </div>
        <div class="cuenta-section">
            <h3>📊 Mis Reportes (${misReportes.length})</h3>
            <ul class="cuenta-reportes">${misReportes.length === 0 ? '<li style="color:var(--gray-400);">Aún no has reportado precios.</li>' : misReportes.slice(-10).reverse().map(r => { const mat = materiales.find(m => m.id === r.material_id); return `<li>📌 ${mat?mat.material:'Material'} - ${r.tipo_operacion}: $${r.precio_kg.toFixed(2)}/kg (${r.estado}, ${r.fecha}) ${r.verificado ? '✅' : '⚠️ Atípico'}</li>`; }).join('')}</ul>
        </div>
        <div class="cuenta-section">
            <h3>🤝 Mis Publicaciones (${misPublicaciones.length})</h3>
            <ul class="cuenta-publicaciones">${(() => {
                let html = '';
                if (misPublicaciones.length === 0) html = '<li style="color:var(--gray-400);">No has publicado en el marketplace.</li>';
                else misPublicaciones.forEach(p => { const mat = materiales.find(m => m.id === p.material_id); html += `<li><span>📢 ${p.tipo}: ${mat?mat.material:'Material'} en ${p.estado} (${p.fecha}) ${p.es_atipico ? '⚠️ Atípico' : ''}</span><div style="display:flex; gap:8px;"><button class="btn-accion editar" onclick="editarPublicacion(${p.id})">✏️ Editar</button><button class="btn-accion eliminar" onclick="eliminarPublicacion(${p.id})">🗑 Eliminar</button></div></li>`; });
                return html;
            })()}</ul>
        </div>
        <div class="cuenta-section">
            <h3>📥 Ofertas recibidas (${ofertasRecibidas.length})</h3>
            ${(() => {
                let html = '';
                if (ofertasRecibidas.length === 0) html = '<p style="color:var(--gray-400);">No has recibido ofertas.</p>';
                else ofertasRecibidas.forEach(o => {
                    const pub = publicacionesMK.find(p => p.id === o.publicacion_id);
                    const mat = pub ? materiales.find(m => m.id === pub.material_id) : null;
                    let estadoClass = o.estado === 'pendiente' ? 'estado-pendiente' : (o.estado === 'aceptada' ? 'estado-aceptada' : 'estado-rechazada');
                    let acciones = '';
                    if (o.estado === 'pendiente') acciones = `<button class="btn-aceptar" onclick="aceptarOferta(${o.id})">✅ Aceptar</button><button class="btn-rechazar" onclick="rechazarOferta(${o.id})">❌ Rechazar</button>`;
                    html += `<div style="padding:10px; border:1px solid var(--gray-200); border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;"><div><strong>${o.vendedor_nombre}</strong> ofrece $${o.precio.toFixed(2)}/kg (${o.volumen} ton) para ${mat ? mat.material : 'material'}<br><em>"${o.mensaje || 'Sin mensaje'}"</em><br><small>${new Date(o.fecha).toLocaleString()}</small><br><span class="${estadoClass}">${o.estado.charAt(0).toUpperCase() + o.estado.slice(1)}</span></div><div>${acciones}</div></div>`;
                });
                return html;
            })()}
        </div>
        <div class="cuenta-section">
            <h3>📤 Ofertas enviadas (${ofertasEnviadas.length})</h3>
            ${(() => {
                let html = '';
                if (ofertasEnviadas.length === 0) html = '<p style="color:var(--gray-400);">No has enviado ofertas.</p>';
                else ofertasEnviadas.forEach(o => {
                    const pub = publicacionesMK.find(p => p.id === o.publicacion_id);
                    const mat = pub ? materiales.find(m => m.id === pub.material_id) : null;
                    let estadoClass = o.estado === 'pendiente' ? 'estado-pendiente' : (o.estado === 'aceptada' ? 'estado-aceptada' : 'estado-rechazada');
                    html += `<div style="padding:10px; border:1px solid var(--gray-200); border-radius:8px; margin-bottom:8px;">Ofreciste <strong>$${o.precio.toFixed(2)}/kg</strong> a ${pub ? pub.usuario_nombre : 'alguien'} por ${mat ? mat.material : 'material'}<br><em>"${o.mensaje || 'Sin mensaje'}"</em><br><small>${new Date(o.fecha).toLocaleString()}</small><br><span class="${estadoClass}">${o.estado.charAt(0).toUpperCase() + o.estado.slice(1)}</span></div>`;
                });
                return html;
            })()}
        </div>
        <div class="cuenta-section">
            <h3>⭐ Calificaciones recibidas (${misCalificaciones.length})</h3>
            <ul class="cuenta-calificaciones">${misCalificaciones.length === 0 ? '<li style="color:var(--gray-400);">Aún no tienes calificaciones.</li>' : misCalificaciones.slice(-5).reverse().map(c => `<li>${'★'.repeat(c.rating)} de ${c.from_name} - "${c.comment || 'Sin comentario'}" (${new Date(c.fecha).toLocaleDateString()})</li>`).join('')}</ul>
        </div>
        <div class="cuenta-section">
            <h3>🔔 Mis Alertas (${misAlertas.length})</h3>
            <ul class="cuenta-publicaciones">${misAlertas.length === 0 ? '<li style="color:var(--gray-400);">No tienes alertas configuradas.</li>' : misAlertas.map(a => { const mat = materiales.find(m => m.id === a.material_id); return `<li>⏰ ${mat?mat.material:'Material'} en ${a.estado} cuando ${a.condicion} de $${a.precio_objetivo.toFixed(2)}/kg</li>`; }).join('')}</ul>
        </div>
    `;
}

// ==================== SUGERENCIA DE MATERIALES ====================
function abrirModalSugerirMaterial() {
    if (!currentUser) { abrirModalAuth(); return; }
    document.getElementById('modalSugerirMaterial').style.display = 'flex';
    document.getElementById('formSugerirMaterial').reset();
}

async function enviarSugerenciaMaterial(e) {
    e.preventDefault();
    const material = document.getElementById('sugMaterial').value.trim();
    const presentacion = document.getElementById('sugPresentacion').value;
    const origen = document.getElementById('sugOrigen').value;
    const color = document.getElementById('sugColor').value.trim() || 'No especificado';
    if (!material) { showToast('El nombre del material es obligatorio.', 'warning'); return; }
    try {
        await apiFetch(`${API_URL}/sugerencias-materiales`, { method: 'POST', body: JSON.stringify({ material, presentacion, origen, color }) });
        document.getElementById('modalSugerirMaterial').style.display = 'none';
        showToast('✅ Sugerencia enviada. Será revisada por el administrador.', 'success');
    } catch (error) {
        showToast('Error al enviar sugerencia: ' + error.message, 'error');
    }
}

// ==================== ADMINISTRACIÓN MEJORADA ====================
function adminLogin(e) {
    e.preventDefault();
    const password = document.getElementById('adminPassword').value;
    adminKey = password;
    localStorage.setItem('adminKey', password);
    apiFetch(`${API_URL}/admin/usuarios`).then(() => {
        document.getElementById('adminLogin').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'block';
        cambiarTabAdmin('hero');
    }).catch(() => {
        showToast('Clave incorrecta', 'error');
        adminKey = '';
        localStorage.removeItem('adminKey');
    });
}

function cambiarTabAdmin(tipo) {
    document.getElementById('adminCurrentTab').value = tipo;
    const config = CONFIG_ANUNCIOS[tipo] || { secciones: [], img: '', link: '', alt: '' };
    document.getElementById('adminSecciones').value = config.secciones.join(', ');
    document.getElementById('adminImg').value = config.img;
    document.getElementById('adminLink').value = config.link;
    document.getElementById('adminAlt').value = config.alt;
}

function adminGuardarAnuncio(e) {
    e.preventDefault();
    const tipo = document.getElementById('adminCurrentTab').value;
    CONFIG_ANUNCIOS[tipo] = {
        secciones: document.getElementById('adminSecciones').value.split(',').map(s => s.trim()).filter(s => s),
        img: document.getElementById('adminImg').value.trim(),
        link: document.getElementById('adminLink').value.trim(),
        alt: document.getElementById('adminAlt').value.trim()
    };
    guardarConfigAnuncios();
    cargarAnuncios(document.querySelector('.panel.active')?.id?.replace('panel-', '') || 'dashboard');
    showToast('✅ Anuncio guardado.', 'success');
}

function cargarAnuncios(panel) {
    ['hero', 'inline', 'report', 'sidebar', 'footer'].forEach(prefix => {
        const img = document.getElementById(`ad-${prefix}-img`);
        const link = document.getElementById(`ad-${prefix}-link`);
        const placeholder = document.getElementById(`ad-${prefix}-placeholder`);
        if (!img || !link || !placeholder) return;
        const config = CONFIG_ANUNCIOS[prefix] || {};
        if (config.secciones?.includes(panel) && config.img) {
            img.src = config.img;
            img.alt = config.alt;
            img.style.display = 'block';
            link.href = config.link;
            placeholder.style.display = 'none';
        } else {
            img.style.display = 'none';
            placeholder.style.display = 'block';
            link.href = '#';
        }
    });
}

function cerrarAdmin() { document.getElementById('modalAdmin').style.display = 'none'; }
function abrirAdmin() { document.getElementById('modalAdmin').style.display = 'flex'; document.getElementById('adminLogin').style.display = 'block'; document.getElementById('adminPanel').style.display = 'none'; document.getElementById('formAdminLogin').reset(); }

// Materiales
function mostrarAdminMateriales() {
    const container = document.getElementById('listaSugerenciasMateriales');
    const pendientes = sugerenciasMateriales.filter(s => s.estado === 'pendiente');
    container.innerHTML = pendientes.length ? pendientes.map(s => `
        <div class="admin-sugerencia-item">
            <div class="admin-sugerencia-info">
                <strong>${s.material}</strong> - ${s.presentacion || 'N/E'} - ${s.origen || 'N/E'} - ${s.color}<br>
                <small>Sugerido por ${s.usuario} el ${new Date(s.fecha).toLocaleDateString()}</small>
            </div>
            <div class="admin-sugerencia-acciones">
                <button class="btn btn-sm btn-primary" onclick="aprobarSugerencia(${s.id})">✅ Aprobar</button>
                <button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="rechazarSugerencia(${s.id})">❌ Rechazar</button>
            </div>
        </div>
    `).join('') : '<p>No hay sugerencias pendientes.</p>';
}

async function aprobarSugerencia(id) {
    await apiFetch(`${API_URL}/sugerencias-materiales/${id}/aprobar`, { method: 'PUT' });
    sugerenciasMateriales = await apiFetch(`${API_URL}/sugerencias-materiales`);
    materiales = await apiFetch(`${API_URL}/materiales`);
    poblarSelectores();
    mostrarAdminMateriales();
    showToast('✅ Material aprobado.', 'success');
}

async function rechazarSugerencia(id) {
    await apiFetch(`${API_URL}/sugerencias-materiales/${id}/rechazar`, { method: 'PUT' });
    sugerenciasMateriales = await apiFetch(`${API_URL}/sugerencias-materiales`);
    mostrarAdminMateriales();
    showToast('Sugerencia rechazada.', 'info');
}

// Admin reportes
async function cargarAdminReportes() {
    const data = await apiFetch(`${API_URL}/admin/reportes`);
    document.getElementById('adminReportes').innerHTML = data.map(r => `<div class="admin-sugerencia-item"><div><strong>${r.material || 'N/A'}</strong> - $${r.precio_kg} (${r.fecha})</div><button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="eliminarAdminReporte(${r.id})">🗑</button></div>`).join('');
}
async function eliminarAdminReporte(id) { if (await confirmModal('¿Eliminar reporte?')) { await apiFetch(`${API_URL}/admin/reportes/${id}`, { method:'DELETE' }); cargarAdminReportes(); } }

// Admin marketplace
async function cargarAdminMarketplace() {
    const data = await apiFetch(`${API_URL}/admin/marketplace`);
    document.getElementById('adminMarketplace').innerHTML = data.map(p => `<div class="admin-sugerencia-item"><div><strong>${p.material || 'N/A'}</strong> - ${p.tipo} (${p.usuario_nombre})</div><button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="eliminarAdminPublicacion(${p.id})">🗑</button></div>`).join('');
}
async function eliminarAdminPublicacion(id) { if (await confirmModal('¿Eliminar publicación?')) { await apiFetch(`${API_URL}/admin/marketplace/${id}`, { method:'DELETE' }); cargarAdminMarketplace(); } }

// Admin usuarios
async function cargarAdminUsuarios() {
    const data = await apiFetch(`${API_URL}/admin/usuarios`);
    document.getElementById('adminUsuarios').innerHTML = data.map(u => `<div class="admin-sugerencia-item"><div>${u.nombre} (${u.email}) - ${u.tipo || 'N/A'}</div></div>`).join('');
}

// ==================== VERIFICACIÓN DE PRECIOS ====================
function configurarVerificacionPrecioReporte() {
    const precioInput = document.getElementById('precioKg');
    const materialSelect = document.getElementById('material');
    const estadoSelect = document.getElementById('estado');
    const warningDiv = document.getElementById('precioWarning');
    function verificar() {
        const precio = parseFloat(precioInput.value);
        const materialId = parseInt(materialSelect.value);
        const estado = estadoSelect.value;
        if (!precio || !materialId || !estado) { warningDiv.style.display = 'none'; return; }
        const resultado = analizarPrecio(precio, materialId, estado);
        if (resultado.nivel !== 'normal') {
            warningDiv.style.display = 'block';
            warningDiv.textContent = resultado.mensaje;
            warningDiv.className = `precio-warning ${resultado.nivel === 'critico' ? 'danger' : 'suspicious'}`;
        } else { warningDiv.style.display = 'none'; }
    }
    precioInput.addEventListener('input', verificar);
    materialSelect.addEventListener('change', verificar);
    estadoSelect.addEventListener('change', verificar);
}

function configurarVerificacionPrecioMarketplace() {
    const precioInput = document.getElementById('mkPrecio');
    const materialSelect = document.getElementById('mkMaterial');
    const estadoSelect = document.getElementById('mkEstado');
    const warningDiv = document.getElementById('mkPrecioWarning');
    function verificar() {
        const precio = parseFloat(precioInput.value);
        const materialId = parseInt(materialSelect.value);
        const estado = estadoSelect.value;
        if (!precio || !materialId || !estado) { warningDiv.style.display = 'none'; return; }
        const resultado = analizarPrecio(precio, materialId, estado);
        if (resultado.nivel !== 'normal') {
            warningDiv.style.display = 'block';
            warningDiv.textContent = resultado.mensaje;
            warningDiv.className = `precio-warning ${resultado.nivel === 'critico' ? 'danger' : 'suspicious'}`;
        } else { warningDiv.style.display = 'none'; }
    }
    if (precioInput) {
        precioInput.addEventListener('input', verificar);
        materialSelect.addEventListener('change', verificar);
        estadoSelect.addEventListener('change', verificar);
    }
}

// ==================== INDICADOR DE CONFIANZA ====================
function actualizarIndicadorConfianza() {
    const banner = document.getElementById('marketTrustBanner');
    const trustLevel = document.getElementById('trustLevel');
    if (!banner || !trustLevel) return;
    const confianza = calcularConfianzaMercado();
    banner.style.display = 'flex';
    trustLevel.textContent = confianza.label;
    trustLevel.className = confianza.nivel;
}

// ==================== NEWSLETTER ====================
function configurarFormularioNewsletter() {}