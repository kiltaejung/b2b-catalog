const tableBody = document.getElementById('catalogTableBody');
const catalogForm = document.getElementById('catalogForm');
const errorsBox = document.getElementById('catalogFormErrors');
const formTitle = document.getElementById('formTitle');
const submitBtn = document.getElementById('submitBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const companyLogoFile = document.getElementById('companyLogoFile');
const clientLogoFile = document.getElementById('clientLogoFile');
const companyLogoPreview = document.getElementById('companyLogoPreview');
const clientLogoPreview = document.getElementById('clientLogoPreview');

let existingCompanyLogoUrl = null;
let existingClientLogoUrl = null;
let allProducts = [];
let pageLayoutState = {};
const pageLayoutContainer = document.getElementById('pageLayoutContainer');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function fetchAllProducts() {
  const res = await fetch('/api/products');
  const data = await res.json();
  allProducts = data.products || [];
}

// Mirrors server/services/catalogService.js resolveCategoryOrder(), but
// only over categories that currently have products, for display purposes.
function computeCategoryOrder(products, categoryOrderText) {
  const present = new Set(products.map((p) => p.category));
  const requested = categoryOrderText
    ? categoryOrderText.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (requested.length) return requested.filter((c) => present.has(c));

  const seen = new Set();
  const order = [];
  products
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .forEach((p) => {
      if (!seen.has(p.category)) {
        seen.add(p.category);
        order.push(p.category);
      }
    });
  return order;
}

// Mirrors public/catalog/js/flipbook.js chunkByLayout(): products are
// consumed greedily in display-order using the configured per-page sizes
// (3, 4, or 6 only); any configured sizes beyond what's needed go unused.
// Unlike flipbook.js's chunkByLayout(), the admin preview renders exactly
// one row per entry in `sizes` — including a trailing page with no
// products left to fill it — so clicking "페이지 추가" always shows a new,
// editable row immediately instead of silently doing nothing until the
// admin also frees up capacity on an earlier page.
function chunkByLayoutPreview(products, sizes) {
  const chunks = [];
  let i = 0;
  const pageCount = Array.isArray(sizes) && sizes.length ? sizes.length : Math.max(1, Math.ceil(products.length / 6));
  for (let pageIdx = 0; pageIdx < pageCount; pageIdx += 1) {
    const configured = Array.isArray(sizes) ? sizes[pageIdx] : undefined;
    const capacity = configured === 3 || configured === 4 || configured === 6 ? configured : 6;
    chunks.push({ capacity, products: products.slice(i, i + capacity) });
    i += capacity;
  }
  return chunks;
}

function renderPageLayoutEditor() {
  const categoryOrderText = document.getElementById('categoryOrder').value;
  const categories = computeCategoryOrder(allProducts, categoryOrderText);

  if (!categories.length) {
    pageLayoutContainer.innerHTML = '<p class="muted">등록된 상품이 없습니다. 먼저 상품을 등록해주세요.</p>';
    return;
  }

  pageLayoutContainer.innerHTML = categories.map((category) => {
    const catProducts = allProducts
      .filter((p) => p.category === category)
      .sort((a, b) => a.display_order - b.display_order);
    if (!pageLayoutState[category] || !pageLayoutState[category].length) {
      pageLayoutState[category] = Array(Math.max(1, Math.ceil(catProducts.length / 6))).fill(6);
    }
    const sizes = pageLayoutState[category];
    const chunks = chunkByLayoutPreview(catProducts, sizes);

    return `
      <div class="pl-category" data-category="${escapeHtml(category)}">
        <div class="pl-category-header">
          <h3>${escapeHtml(category)}</h3>
          <span>총 ${catProducts.length}개 상품 · ${chunks.length}페이지</span>
        </div>
        ${chunks.map((chunk, idx) => `
          <div class="pl-page-row" data-page-index="${idx}">
            <span class="pl-page-label">페이지 ${idx + 1}</span>
            <select data-pl-count>
              <option value="3" ${chunk.capacity === 3 ? 'selected' : ''}>3개</option>
              <option value="4" ${chunk.capacity === 4 ? 'selected' : ''}>4개</option>
              <option value="6" ${chunk.capacity === 6 ? 'selected' : ''}>6개</option>
            </select>
            <span class="pl-page-preview">${chunk.products.map((p) => escapeHtml(p.name)).join(', ') || '(배치될 상품 없음)'}</span>
            <div class="pl-page-actions">
              <button type="button" class="secondary" data-pl-move="up" ${idx === 0 ? 'disabled' : ''}>▲</button>
              <button type="button" class="secondary" data-pl-move="down" ${idx === chunks.length - 1 ? 'disabled' : ''}>▼</button>
              <button type="button" class="danger" data-pl-remove>삭제</button>
            </div>
          </div>
        `).join('')}
        <button type="button" class="secondary pl-add-page" data-pl-add>+ 페이지 추가</button>
      </div>
    `;
  }).join('');
}

pageLayoutContainer.addEventListener('click', (e) => {
  const catEl = e.target.closest('.pl-category');
  if (!catEl) return;
  const category = catEl.dataset.category;
  const sizes = pageLayoutState[category];

  if (e.target.matches('[data-pl-add]')) {
    sizes.push(6);
    renderPageLayoutEditor();
    return;
  }

  const rowEl = e.target.closest('.pl-page-row');
  if (!rowEl) return;
  const idx = Number(rowEl.dataset.pageIndex);

  if (e.target.matches('[data-pl-remove]')) {
    if (!confirm('해당 페이지를 삭제하시겠습니까? 배치된 상품은 다음 페이지에 자동으로 재배치됩니다.')) return;
    sizes.splice(idx, 1);
    renderPageLayoutEditor();
    return;
  }
  if (e.target.matches('[data-pl-move="up"]') && idx > 0) {
    [sizes[idx - 1], sizes[idx]] = [sizes[idx], sizes[idx - 1]];
    renderPageLayoutEditor();
    return;
  }
  if (e.target.matches('[data-pl-move="down"]') && idx < sizes.length - 1) {
    [sizes[idx + 1], sizes[idx]] = [sizes[idx], sizes[idx + 1]];
    renderPageLayoutEditor();
  }
});

pageLayoutContainer.addEventListener('change', (e) => {
  if (!e.target.matches('[data-pl-count]')) return;
  const catEl = e.target.closest('.pl-category');
  const rowEl = e.target.closest('.pl-page-row');
  const idx = Number(rowEl.dataset.pageIndex);
  pageLayoutState[catEl.dataset.category][idx] = Number(e.target.value);
  renderPageLayoutEditor();
});

document.getElementById('categoryOrder').addEventListener('input', renderPageLayoutEditor);

function buildPageLayoutPayload() {
  const categoryOrderText = document.getElementById('categoryOrder').value;
  const categories = computeCategoryOrder(allProducts, categoryOrderText);
  const result = {};
  categories.forEach((c) => {
    if (pageLayoutState[c] && pageLayoutState[c].length) result[c] = pageLayoutState[c];
  });
  return result;
}

async function fetchCatalogs() {
  const res = await fetch('/api/catalogs');
  const data = await res.json();
  renderCatalogs(data.catalogs || []);
}

function renderCatalogs(catalogs) {
  tableBody.innerHTML = '';
  catalogs.forEach((c) => {
    const tr = document.createElement('tr');
    const createdAt = new Date(c.created_at).toLocaleString('ko-KR');
    tr.innerHTML = `
      <td>${c.client_name || '-'}</td>
      <td>${c.show_price ? '표시' : '숨김'}</td>
      <td>${createdAt}</td>
      <td>
        <a href="/catalog/index.html?id=${c.id}" target="_blank"><button type="button" class="secondary">미리보기</button></a>
        <button type="button" class="secondary" data-edit="${c.id}">수정</button>
        <button type="button" class="danger" data-delete="${c.id}">삭제</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function setPreview(imgEl, url) {
  if (url) {
    imgEl.src = url;
    imgEl.style.display = '';
  } else {
    imgEl.style.display = 'none';
    imgEl.removeAttribute('src');
  }
}

function resetToCreateMode() {
  catalogForm.reset();
  document.getElementById('catalogId').value = '';
  document.getElementById('showPrice').checked = true;
  document.getElementById('maxZoom').value = 3;
  existingCompanyLogoUrl = null;
  existingClientLogoUrl = null;
  setPreview(companyLogoPreview, null);
  setPreview(clientLogoPreview, null);
  formTitle.textContent = '카탈로그 생성';
  submitBtn.textContent = '카탈로그 생성 (전체 상품 포함)';
  cancelEditBtn.style.display = 'none';
  errorsBox.style.display = 'none';
  pageLayoutState = {};
  renderPageLayoutEditor();
}

async function enterEditMode(catalogId) {
  const res = await fetch(`/api/catalogs/${catalogId}`);
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || '카탈로그를 불러올 수 없습니다.');
    return;
  }
  const c = data.catalog;
  document.getElementById('catalogId').value = c.id;
  document.getElementById('seasonName').value = c.seasonName || '';
  document.getElementById('mainTitle').value = c.mainTitle || '';
  document.getElementById('coverImageUrl').value = c.coverImageUrl || '';
  document.getElementById('backCoverImageUrl').value = c.backCoverImageUrl || '';
  document.getElementById('clientName').value = c.clientName || '';
  document.getElementById('showPrice').checked = Boolean(c.showPrice);
  document.getElementById('categoryOrder').value = (c.categories || []).map((cat) => cat.category).join(',');
  document.getElementById('maxZoom').value = c.maxZoom || 3;

  pageLayoutState = JSON.parse(JSON.stringify(c.pageLayout || {}));
  renderPageLayoutEditor();

  existingCompanyLogoUrl = c.companyLogoUrl || null;
  existingClientLogoUrl = c.clientLogoUrl || null;
  setPreview(companyLogoPreview, existingCompanyLogoUrl);
  setPreview(clientLogoPreview, existingClientLogoUrl);
  companyLogoFile.value = '';
  clientLogoFile.value = '';

  formTitle.textContent = '카탈로그 수정';
  submitBtn.textContent = '카탈로그 수정 저장';
  cancelEditBtn.style.display = '';
  errorsBox.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function uploadIfSelected(fileInput) {
  if (!fileInput.files.length) return null;
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  const res = await fetch('/api/uploads', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '이미지 업로드에 실패했습니다.');
  return data.url;
}

companyLogoFile.addEventListener('change', () => {
  if (companyLogoFile.files.length) {
    setPreview(companyLogoPreview, URL.createObjectURL(companyLogoFile.files[0]));
  }
});
clientLogoFile.addEventListener('change', () => {
  if (clientLogoFile.files.length) {
    setPreview(clientLogoPreview, URL.createObjectURL(clientLogoFile.files[0]));
  }
});

tableBody.addEventListener('click', async (e) => {
  const deleteId = e.target.dataset.delete;
  const editId = e.target.dataset.edit;

  if (deleteId) {
    if (!confirm('이 카탈로그를 삭제하시겠습니까?')) return;
    await fetch(`/api/catalogs/${deleteId}`, { method: 'DELETE' });
    fetchCatalogs();
    return;
  }

  if (editId) {
    enterEditMode(editId);
  }
});

cancelEditBtn.addEventListener('click', resetToCreateMode);

catalogForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorsBox.style.display = 'none';

  let companyLogoUrl = existingCompanyLogoUrl;
  let clientLogoUrl = existingClientLogoUrl;
  try {
    const uploadedCompanyLogo = await uploadIfSelected(companyLogoFile);
    if (uploadedCompanyLogo) companyLogoUrl = uploadedCompanyLogo;
    const uploadedClientLogo = await uploadIfSelected(clientLogoFile);
    if (uploadedClientLogo) clientLogoUrl = uploadedClientLogo;
  } catch (err) {
    errorsBox.style.display = 'block';
    errorsBox.textContent = err.message;
    return;
  }

  const categoryOrderRaw = document.getElementById('categoryOrder').value.trim();
  const payload = {
    seasonName: document.getElementById('seasonName').value || null,
    mainTitle: document.getElementById('mainTitle').value,
    companyLogoUrl,
    coverImageUrl: document.getElementById('coverImageUrl').value || null,
    backCoverImageUrl: document.getElementById('backCoverImageUrl').value || null,
    clientName: document.getElementById('clientName').value || null,
    clientLogoUrl,
    showPrice: document.getElementById('showPrice').checked,
    categoryOrder: categoryOrderRaw ? categoryOrderRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    maxZoom: Number(document.getElementById('maxZoom').value) || 3,
    pageLayout: buildPageLayoutPayload(),
  };

  const catalogId = document.getElementById('catalogId').value;
  const url = catalogId ? `/api/catalogs/${catalogId}` : '/api/catalogs';
  const method = catalogId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    errorsBox.style.display = 'block';
    errorsBox.textContent = data.error || '카탈로그 저장에 실패했습니다.';
    return;
  }

  resetToCreateMode();
  fetchCatalogs();
});

async function init() {
  await fetchAllProducts();
  renderPageLayoutEditor();
  await fetchCatalogs();
}
init();
