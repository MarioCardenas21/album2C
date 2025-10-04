
const $  = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

function escapeHTML(str){
  return String(str).replace(/[&<>"']/g, s => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[s]));
}

/* Obtiene una variable CSS si existiera (fallbacks de color) */
function getCss(varName){
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || "";
}

/* Placeholder SVG para una tarjeta (si no hay imagen real) */
function placeholderSVG(label, color = "#6ee7ff"){
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0.04"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${color}" stroke-opacity=".08" />
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="#0f1420"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect x="0" y="0" width="100%" height="100%" fill="url(#g)"/>
  <g fill="${color}" opacity="0.9">
    <circle cx="90" cy="90" r="34" opacity="0.35"/>
    <circle cx="560" cy="70" r="18" opacity="0.25"/>
    <circle cx="520" cy="300" r="28" opacity="0.2"/>
  </g>
  <g font-family="ui-monospace, Menlo, Consolas" fill="${color}">
    <text x="32" y="320" font-size="18" opacity=".8">${label}</text>
  </g>
</svg>`;
}

/* Decide si renderear <img> o un SVG placeholder */
function mediaHTML(p){
  if (p.image && typeof p.image === "string") {
    // Soporta rutas locales, URLs remotas o data:base64
    return `<img src="${p.image}" alt="${escapeHTML(p.name)}" loading="lazy" decoding="async">`;
  }
  // Si el JSON trae un SVG inline (opcional)
  if (p.media && String(p.media).trim().startsWith("<svg")) {
    return p.media;
  }
  const meta = CATEGORY_META[p.category] || { color: "#6ee7ff", icon: "IMG" };
  const color = meta.color || "#6ee7ff";
  const icon  = meta.icon  || "IMG";
  return placeholderSVG(icon, color);
}

/* --------- Estado global + referencias DOM ---------- */
let CATEGORY_META = {}; // se llena desde app-data.json
let PRODUCTS = [];      // se llena desde app-data.json

const state = {
  activeCategory: null, // se define al cargar
  query: "",
  sort: "relevance",
  compare: [], // {id, category, name, brand, price, details, description, media/image}
};

const catsNav          = $("#categoriesNav");
const grid             = $("#cardsGrid");
const resultInfo       = $("#resultInfo");
const searchInput      = $("#searchInput");
const sortSelect       = $("#sortSelect");

const compareBar       = $("#compareBar");
const compareCount     = $("#compareCount");
const compareCategory  = $("#compareCategory");
const compareList      = $("#compareList");
const btnOpenCompare   = $("#btnOpenCompare");
const btnClearCompare  = $("#btnClearCompare");
const compareModal     = $("#compareModal");
const btnCloseModal    = $("#btnCloseModal");
const compareTable     = $("#compareTable");

/* ---------- Carga de datos ---------- */
async function loadData(){
  const res = await fetch('app-data.json', { cache: 'no-store' });
  if(!res.ok) throw new Error("No se pudo cargar app-data.json");
  const data = await res.json();

  CATEGORY_META = data.categories || {};
  PRODUCTS      = data.products  || [];

  // Fallback: si faltara color en JSON, intenta tomar de CSS vars
  const cssFallbacks = {
    "CPU":"--cpu","GPU":"--gpu","RAM":"--ram","Motherboard":"--mb",
    "Almacenamiento":"--sto","Fuente":"--psu","Gabinete":"--case",
    "Refrigeración":"--cool","Periféricos":"--peri","Accesorios":"--acc"
  };
  Object.keys(cssFallbacks).forEach(cat=>{
    if(!CATEGORY_META[cat]) CATEGORY_META[cat] = { color: "", icon: cat.slice(0,3).toUpperCase() };
    if(!CATEGORY_META[cat].color){
      const c = getCss(cssFallbacks[cat]);
      CATEGORY_META[cat].color = c || CATEGORY_META[cat].color || "#6ee7ff";
    }
  });

  console.log("CATEGORÍAS:", Object.keys(CATEGORY_META).length, CATEGORY_META);
  console.log("PRODUCTOS:", PRODUCTS.length);
}

/* ---------- Construcción de UI ---------- */
function svgDot(color){ return `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="${color}"/></svg>`; }

function buildCategories(){
  const cats = Object.keys(CATEGORY_META);
  catsNav.innerHTML = cats.map(cat=>{
    const meta = CATEGORY_META[cat] || {};
    const color = meta.color || "#6ee7ff";
    return `<button class="cat-chip" data-cat="${cat}">
      ${svgDot(color)}
      <span>${cat}</span>
      <span class="count badge" id="count-${cat}">0</span>
    </button>`;
  }).join("");

  updateCategoryCounts();

  catsNav.addEventListener("click", (e)=>{
    const btn = e.target.closest(".cat-chip");
    if(!btn) return;
    state.activeCategory = btn.dataset.cat;
    highlightActiveCategory();
    state.compare = []; // limpiar comparación al cambiar de categoría
    renderCompare();
    renderGrid();
  });

  // Activar la primera por defecto si no está seteada
  if(!state.activeCategory){
    state.activeCategory = cats[0] || "CPU";
  }
  highlightActiveCategory();
}

function highlightActiveCategory(){
  $$(".cat-chip", catsNav).forEach(b=>{
    b.classList.toggle("active", b.dataset.cat === state.activeCategory);
  });
}

function updateCategoryCounts(){
  const counts = {};
  for(const p of PRODUCTS){
    counts[p.category] = (counts[p.category] || 0) + 1;
  }
  Object.keys(CATEGORY_META).forEach(cat=>{
    const el = document.getElementById(`count-${cat}`);
    if(el) el.textContent = counts[cat] || 0;
  });
}

/* ---------- Lógica de filtro/orden/búsqueda ---------- */
function getVisibleProducts(){
  const q = state.query.trim().toLowerCase();
  let list = PRODUCTS.filter(p => p.category === state.activeCategory);

  if(q){
    list = list.filter(p =>
      `${p.name} ${p.brand} ${p.description} ${p.details}`.toLowerCase().includes(q)
    );
  }

  switch(state.sort){
    case "price-asc":  list.sort((a,b)=>a.price-b.price); break;
    case "price-desc": list.sort((a,b)=>b.price-a.price); break;
    case "brand-asc":  list.sort((a,b)=>a.brand.localeCompare(b.brand)); break;
    case "name-asc":   list.sort((a,b)=>a.name .localeCompare(b.name)); break;
    default: /* relevance -> no-op demo */ break;
  }
  return list;
}

/* ---------- Render de tarjetas ---------- */
function renderGrid(){
  const list = getVisibleProducts();
  resultInfo.textContent = `${list.length} resultados · Categoría: ${state.activeCategory}`;

  grid.innerHTML = list.map(p=>{
    const pid = productId(p);
    const checked = state.compare.some(c=>c.id===pid) ? "checked" : "";
    return `
    <article class="card" data-id="${pid}">
      <div class="card-media">
        ${mediaHTML(p)}
      </div>
      <div class="card-body">
        <div class="card-title">
          <h3>${escapeHTML(p.name)}</h3>
          <div class="price">$${p.price}</div>
        </div>
        <div class="brand">${escapeHTML(p.brand)}</div>
        <div class="desc">${escapeHTML(p.description)}</div>
        <div class="meta">${escapeHTML(p.details)}</div>
      </div>
      <div class="card-actions">
        <span class="tag">${p.category}</span>
        <label class="btn">
          <input type="checkbox" data-compare="${pid}" ${checked} />
          &nbsp;Añadir a comparar
        </label>
      </div>
    </article>`;
  }).join("");

  // Wire de checkboxes
  $$("input[type=checkbox][data-compare]", grid).forEach(chk=>{
    chk.addEventListener("change", (e)=>{
      const id = e.target.getAttribute("data-compare");
      const item = PRODUCTS.find(p => productId(p)===id);
      if(!item) return;
      toggleCompare(item, e.target.checked);
      // re-sincroniza el estado visual por si se rechazó (categoría distinta o límite)
      e.target.checked = state.compare.some(c=>c.id===id);
    });
  });
}

/* ---------- Comparador ---------- */
function productId(p){ return `${p.category}:${p.brand}:${p.name}`; }

function toggleCompare(item, wantAdd){
  const id = productId(item);

  if(!wantAdd){
    state.compare = state.compare.filter(c=>c.id!==id);
    renderCompare();
    return;
  }

  // Solo misma categoría
  if(state.compare.length>0 && state.compare[0].category !== item.category){
    alert("Solo puedes comparar productos dentro de la MISMA categoría.");
    return;
  }

  // Límite de 4
  if(state.compare.length >= 4){
    alert("Puedes comparar hasta 4 productos a la vez.");
    return;
  }

  if(!state.compare.some(c=>c.id===id)){
    state.compare.push({
      id,
      category: item.category,
      name: item.name,
      brand: item.brand,
      price: item.price,
      description: item.description,
      details: item.details,
      media: item.media || null,
      image: item.image || null
    });
  }
  renderCompare();
}

function renderCompare(){
  compareCount.textContent = `${state.compare.length} seleccionados`;
  compareCategory.textContent = state.compare.length ? `· ${state.compare[0].category}` : "";
  btnOpenCompare.disabled = state.compare.length < 2;

  compareList.innerHTML = state.compare.map(c=>`
    <span class="compare-pill" title="${escapeHTML(c.name)}">
      ${c.image ? `<img src="${c.image}" alt="${escapeHTML(c.name)}">` : (c.media && String(c.media).startsWith("<svg") ? c.media : placeholderSVG(CATEGORY_META[c.category]?.icon || "IMG", CATEGORY_META[c.category]?.color || "#6ee7ff"))}
      <span>${escapeHTML(c.name)}</span>
      <button aria-label="Quitar" data-remove="${c.id}">✕</button>
    </span>
  `).join("");

  $$("button[data-remove]", compareList).forEach(btn=>{
    btn.addEventListener("click", ()=>{
      state.compare = state.compare.filter(c=>c.id!==btn.getAttribute("data-remove"));
      renderCompare();
      renderGrid();
    });
  });
}

function openCompareModal(){
  if(state.compare.length < 2) return;
  const cols = state.compare;
  const headers = ["Atributo", ...cols.map(c=>escapeHTML(c.name))];

  const rows = [
    ["Marca",        ...cols.map(c=>escapeHTML(c.brand))],
    ["Precio (USD)", ...cols.map(c=>"$"+c.price)],
    ["Descripción",  ...cols.map(c=>escapeHTML(c.description))],
    ["Detalles",     ...cols.map(c=>escapeHTML(c.details))]
  ];

  compareTable.innerHTML = `
    <thead>
      <tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr>
    </thead>
    <tbody>
      ${rows.map(r=>`<tr>${r.map((cell,i)=> i===0? `<th>${cell}</th>` : `<td>${cell}</td>`).join("")}</tr>`).join("")}
    </tbody>
  `;

  compareModal.showModal();
}

/* ---------- Eventos de UI ---------- */
searchInput.addEventListener("input", (e)=>{ state.query = e.target.value; renderGrid(); });
sortSelect.addEventListener("change", (e)=>{ state.sort = e.target.value; renderGrid(); });
btnOpenCompare.addEventListener("click", openCompareModal);
btnClearCompare.addEventListener("click", ()=>{ state.compare=[]; renderCompare(); renderGrid(); });
btnCloseModal.addEventListener("click", ()=> compareModal.close());

/* ---------- Inicio ---------- */
(async ()=>{
  try{
    await loadData();
    // categoría por defecto si no fue fijada
    if(!state.activeCategory){
      const cats = Object.keys(CATEGORY_META);
      state.activeCategory = cats[0] || "CPU";
    }
    buildCategories();
    renderGrid();
    renderCompare();
  }catch(err){
    console.error(err);
    alert("Error cargando datos. Revisa que 'app-data.json' esté junto a index.html.");
  }
})();
