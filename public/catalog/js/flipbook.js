const PRODUCTS_PER_GRID_PAGE = 6;
const CART_STORAGE_KEY = 'b2bCatalogCart';

const state = {
  catalog: null,
  pages: [],
  productPageIndex: {},
  tocEntries: [],
  currentPageIndex: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  budgetFilter: null,
  settings: {
    darkMode: true,
    autoFit: true,
  },
};

const params = new URLSearchParams(window.location.search);
const catalogId = params.get('id');

const bookViewport = document.getElementById('bookViewport');
const bookFlipEl = document.getElementById('bookFlip');
const bookStage = document.getElementById('bookStage');
const pageSlider = document.getElementById('pageSlider');
const pageCurrentText = document.getElementById('pageCurrentText');
const totalPagesEl = document.getElementById('totalPages');
const loadingScreen = document.getElementById('loadingScreen');

let pageFlip = null;

function getMaxZoom() {
  return (state.catalog && state.catalog.maxZoom) || 3;
}

function clampZoom(z) {
  return Math.min(getMaxZoom(), Math.max(0.6, z));
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

function formatPrice(value) {
  return `${Number(value).toLocaleString()}원`;
}

function buildPages(catalog) {
  const pages = [];
  const productPageIndex = {};
  const categoryStartPage = {};

  pages.push({ type: 'cover' });
  const tocPageIndex = pages.length;
  pages.push({ type: 'toc', entries: [] });

  catalog.categories.forEach((catEntry) => {
    categoryStartPage[catEntry.category] = pages.length;
    const chunks = chunkArray(catEntry.products, PRODUCTS_PER_GRID_PAGE);
    chunks.forEach((chunk, chunkIdx) => {
      pages.push({
        type: 'categoryGrid',
        category: catEntry.category,
        partIndex: chunkIdx,
        partTotal: chunks.length,
        products: chunk,
      });
    });
    catEntry.products.forEach((p) => {
      productPageIndex[p.id] = pages.length;
      pages.push({ type: 'product', product: p, category: catEntry.category });
    });
  });

  pages.push({ type: 'back' });

  const tocEntries = catalog.categories.map((c) => ({
    category: c.category,
    page: categoryStartPage[c.category] + 1,
  }));
  pages[tocPageIndex].entries = tocEntries;

  return { pages, productPageIndex, tocEntries };
}

function pageHtml(pageData) {
  const catalog = state.catalog;
  if (!pageData) return '<div class="page blank"></div>';

  switch (pageData.type) {
    case 'cover':
      // A supplied cover image is treated as the finished, fully-designed
      // cover (title/greeting/CTA already baked into the artwork), so it
      // renders as-is with no text overlay or darkening scrim. Without one,
      // fall back to rendering the title/season/client info as HTML on the
      // plain gradient background.
      if (catalog.coverImageUrl) {
        return `
          <div class="page" data-density="hard">
            <div class="cover-image-wrap">
              <img src="${catalog.coverImageUrl}" alt="표지" />
            </div>
          </div>`;
      }
      return `
        <div class="page" data-density="hard">
          <div class="page-cover">
            <div class="cover-overlay">
              <div>
                <div class="brand-row">
                  ${catalog.companyLogoUrl ? `<img src="${catalog.companyLogoUrl}" alt="logo" />` : ''}
                </div>
                ${catalog.seasonName ? `<div class="season">${escapeHtml(catalog.seasonName)}</div>` : ''}
              </div>
              <div>
                <div class="main-title">${escapeHtml(catalog.mainTitle)}</div>
                ${catalog.clientName ? `
                  <div class="client-tag" style="margin-top:0.9rem">
                    ${catalog.clientLogoUrl ? `<img src="${catalog.clientLogoUrl}" alt="client" />` : ''}
                    <span>${escapeHtml(catalog.clientName)} 전용 카탈로그</span>
                  </div>` : ''}
              </div>
            </div>
          </div>
        </div>`;

    case 'toc':
      return `
        <div class="page">
          <div class="toc-title">목차</div>
          <ul class="toc-list">
            ${pageData.entries.map((e) => `
              <li data-goto="${e.page}">
                <span>${escapeHtml(e.category)}</span>
                <span class="dots"></span>
                <span>${e.page}</span>
              </li>`).join('')}
          </ul>
        </div>`;

    case 'categoryGrid':
      return `
        <div class="page">
          <div class="category-banner">
            <h2>${escapeHtml(pageData.category)}${pageData.partTotal > 1 ? ` (${pageData.partIndex + 1}/${pageData.partTotal})` : ''}</h2>
          </div>
          <div class="product-grid">
            ${pageData.products.map((p) => `
              <div class="product-tile" data-goto="${state.productPageIndex[p.id] + 1}">
                <div class="image-frame">
                  <img src="${p.imageUrl}" onerror="this.src='/assets/no-image.svg'" alt="${escapeHtml(p.name)}" />
                  ${promoStampHtml(p.promoBadge)}
                </div>
                ${p.brand ? `<div class="brand-badge">${escapeHtml(p.brand)}</div>` : ''}
                <div class="tile-name">${escapeHtml(p.name)}</div>
                ${catalog.showPrice ? `
                  <div class="price-badge">
                    ${p.originalPrice ? `<span class="original">${formatPrice(p.originalPrice)}</span>` : ''}
                    ${formatPrice(p.salePrice)}
                  </div>` : ''}
              </div>`).join('')}
          </div>
        </div>`;

    case 'product': {
      const p = pageData.product;
      return `
        <div class="page product-detail">
          <div class="image-frame">
            <img class="hero" src="${p.imageUrl}" onerror="this.src='/assets/no-image.svg'" alt="${escapeHtml(p.name)}" />
            ${promoStampHtml(p.promoBadge)}
          </div>
          <h2>${escapeHtml(p.name)}</h2>
          <div class="brand-line">${p.brand ? escapeHtml(p.brand) : ''} ${p.productCode ? `· ${escapeHtml(p.productCode)}` : ''}</div>
          ${catalog.showPrice ? `
            <div class="price-line">
              ${p.originalPrice ? `<span class="original">${formatPrice(p.originalPrice)}</span>` : ''}
              ${formatPrice(p.salePrice)}
            </div>` : ''}
          <table class="spec-table">
            <tr><th>상품구성</th><td>${escapeHtml(p.composition || '-')}</td></tr>
            ${p.packaging ? `<tr><th>포장</th><td>${escapeHtml(p.packaging)}</td></tr>` : ''}
            ${p.origin ? `<tr><th>원산지</th><td>${escapeHtml(p.origin)}</td></tr>` : ''}
            ${p.taxType ? `<tr><th>면세/과세</th><td>${escapeHtml(p.taxType)}</td></tr>` : ''}
            ${p.features ? `<tr><th>규격</th><td>${escapeHtml(p.features)}</td></tr>` : ''}
            ${p.shippingInfo ? `<tr><th>배송안내</th><td>${escapeHtml(p.shippingInfo)}</td></tr>` : ''}
          </table>
          ${p.description ? `<div class="desc-block">${escapeHtml(p.description)}</div>` : ''}
          <button class="btn-add-cart" data-add-cart="${p.id}">견적 담기</button>
        </div>`;
    }

    case 'back':
      return `
        <div class="page back-page" data-density="hard">
          <h2>주문 안내</h2>
          <section>본 카탈로그에서 마음에 드는 상품을 '견적 담기'로 담아 담당자에게 문의해주세요. 최소 주문 수량 및 조건은 상품별로 상이할 수 있습니다.</section>
          <h2>배송 안내</h2>
          <section>주문 확인 후 영업일 기준 2~3일 이내 출고되며, 상품별 배송 안내는 각 상품 페이지를 참고해주세요.</section>
          <h2>회사 정보 / 문의처</h2>
          <section>
            ${catalog.companyLogoUrl ? `<img src="${catalog.companyLogoUrl}" alt="logo" style="height:32px;margin-bottom:0.5rem" />` : ''}
            <div>문의 및 주문 관련 문의는 담당 영업 채널로 연락 부탁드립니다.</div>
          </section>
        </div>`;

    default:
      return '<div class="page blank"></div>';
  }
}

function promoStampHtml(promoBadge) {
  if (!promoBadge) return '';
  const cls = promoBadge === '베스트' ? 'promo-stamp badge-best' : 'promo-stamp';
  return `<div class="${cls}">${escapeHtml(promoBadge)}</div>`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// Book rendering — a single page is always shown, one at a time, using
// the page-flip library for a realistic paper-curl turn animation.
// ---------------------------------------------------------------------
function buildPageElements() {
  const wrap = document.createElement('div');
  wrap.innerHTML = state.pages.map((p) => pageHtml(p)).join('');
  return Array.from(wrap.children);
}

function updateNavUI(oneBasedPage) {
  const total = state.pages.length;
  pageCurrentText.textContent = oneBasedPage;
  totalPagesEl.textContent = total;
  pageSlider.min = 1;
  pageSlider.max = total;
  pageSlider.value = oneBasedPage;
  resetPan();
  if (state.settings.autoFit) setZoom(1, false);
}

function initPageFlip() {
  // width:height must match the .book-flip aspect-ratio exactly — PageFlip's
  // "stretch" mode derives its internal page geometry from this ratio, and
  // any mismatch against the container's real rendered ratio leaves gaps
  // and breaks its own drag/corner hit-testing (see the CSS comment).
  // minWidth is set so the portrait/landscape switch (at 2×minWidth) lands
  // on the same 860px container width where the CSS aspect-ratio itself
  // switches (from the @media breakpoint below) — otherwise there's a
  // window-width range where the two disagree and the gap/hit-test bug
  // above comes right back.
  pageFlip = new St.PageFlip(bookFlipEl, {
    width: 480,
    height: 626,
    size: 'stretch',
    minWidth: 430,
    maxWidth: 660,
    minHeight: 560,
    maxHeight: 860,
    maxShadowOpacity: 0.5,
    showCover: true,
    usePortrait: true,
    mobileScrollSupport: true,
  });
  pageFlip.loadFromHTML(buildPageElements());
  pageFlip.on('flip', (e) => {
    state.currentPageIndex = e.data;
    updateNavUI(e.data + 1);
  });
  updateNavUI(1);
}

// PageFlip treats any mousedown/touchstart on a page as the start of a
// possible flip — including ones landing on a product tile, TOC entry, or
// the add-to-cart button. disableFlipByClick can't fix this without also
// breaking flipNext()/flipPrev() (both route through the same click gate),
// so instead the interactive elements themselves stop the press from ever
// reaching PageFlip's listener, in the capture phase, before it can start
// tracking a flip. The follow-up 'click' event is untouched and still
// reaches our own data-goto/data-add-cart handling below.
const INTERACTIVE_SELECTOR = 'button, a, input, [data-goto], [data-add-cart]';
function stopIfInteractive(e) {
  if (e.target.closest(INTERACTIVE_SELECTOR)) e.stopPropagation();
}
bookFlipEl.addEventListener('mousedown', stopIfInteractive, true);
bookFlipEl.addEventListener('touchstart', stopIfInteractive, true);

function goToPage(oneBasedIndex) {
  const total = state.pages.length;
  const clamped = Math.min(Math.max(oneBasedIndex, 1), total);
  pageFlip.turnToPage(clamped - 1);
  state.currentPageIndex = clamped - 1;
  updateNavUI(clamped);
}

function next() {
  pageFlip.flipNext();
}

function prev() {
  pageFlip.flipPrev();
}

function first() {
  goToPage(1);
}

function last() {
  goToPage(state.pages.length);
}

bookFlipEl.addEventListener('click', (e) => {
  const gotoEl = e.target.closest('[data-goto]');
  if (gotoEl) {
    goToPage(Number(gotoEl.dataset.goto));
    return;
  }
  const addCartEl = e.target.closest('[data-add-cart]');
  if (addCartEl) {
    addToCart(Number(addCartEl.dataset.addCart));
  }
});

document.getElementById('btnNext').addEventListener('click', next);
document.getElementById('btnPrev').addEventListener('click', prev);
document.getElementById('btnFirst').addEventListener('click', first);
document.getElementById('btnLast').addEventListener('click', last);

pageSlider.addEventListener('input', () => goToPage(Number(pageSlider.value)));

// ---------------------------------------------------------------------
// Shared bottom-sheet / float-bar system
// ---------------------------------------------------------------------
const sheetOverlay = document.getElementById('sheetOverlay');
const allSheets = Array.from(document.querySelectorAll('.bottom-sheet'));
const allFloatBars = Array.from(document.querySelectorAll('.float-bar'));
let activeSheet = null;

function closeAllFloatBars() {
  allFloatBars.forEach((bar) => bar.classList.remove('open'));
}

function closeSheet() {
  if (activeSheet) activeSheet.classList.remove('open');
  activeSheet = null;
  sheetOverlay.classList.remove('open');
}

function openSheet(el) {
  closeAllFloatBars();
  allSheets.forEach((s) => s.classList.remove('open'));
  el.classList.add('open');
  activeSheet = el;
  sheetOverlay.classList.add('open');
}

sheetOverlay.addEventListener('click', closeSheet);
document.querySelectorAll('[data-close-sheet]').forEach((btn) => {
  btn.addEventListener('click', closeSheet);
});

function toggleFloatBar(bar) {
  const willOpen = !bar.classList.contains('open');
  closeSheet();
  closeAllFloatBars();
  if (willOpen) bar.classList.add('open');
}

const pageNavBar = document.getElementById('pageNavBar');
const zoomBar = document.getElementById('zoomBar');
document.getElementById('btnPageNavToggle').addEventListener('click', () => toggleFloatBar(pageNavBar));
document.getElementById('btnZoomToggle').addEventListener('click', () => toggleFloatBar(zoomBar));

document.getElementById('btnShare').addEventListener('click', () => openSheet(document.getElementById('shareSheet')));
document.getElementById('btnMore').addEventListener('click', () => openSheet(document.getElementById('moreSheet')));
document.getElementById('btnThumbnail').addEventListener('click', () => {
  openSheet(document.getElementById('thumbnailSheet'));
  renderThumbnails();
});
document.getElementById('btnToc').addEventListener('click', () => {
  openSheet(document.getElementById('tocSheet'));
  renderTocPanel();
});

// ---------------------------------------------------------------------
// Zoom + pan + pinch + double-tap. Page-turning itself (drag, swipe, edge
// click) is owned by the page-flip library now, so this layer only ever
// engages for pinch-zoom and panning/double-tap-zoom once zoomed in.
// ---------------------------------------------------------------------
const zoomLevelText = document.getElementById('zoomLevelText');

function resetPan() {
  state.panX = 0;
  state.panY = 0;
}

function applyStageTransform() {
  bookStage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(z, animate = true) {
  state.zoom = clampZoom(z);
  if (state.zoom <= 1.001) resetPan();
  bookStage.classList.toggle('panning', !animate);
  applyStageTransform();
}

document.getElementById('btnZoomIn').addEventListener('click', () => setZoom(state.zoom + 0.25));
document.getElementById('btnZoomOut').addEventListener('click', () => setZoom(state.zoom - 0.25));
document.getElementById('btnZoomReset').addEventListener('click', () => setZoom(1));

const activePointers = new Map();
let singlePointerStart = null;
let gestureStartDistance = 0;
let gestureStartZoom = 1;
let isPinching = false;
let lastTapTime = 0;
let lastTapPos = null;

function pointDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

bookViewport.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 1) {
    singlePointerStart = {
      x: e.clientX, y: e.clientY, time: Date.now(),
      panX: state.panX, panY: state.panY, target: e.target,
    };
  } else if (activePointers.size === 2) {
    isPinching = true;
    const pts = Array.from(activePointers.values());
    gestureStartDistance = pointDistance(pts[0], pts[1]) || 1;
    gestureStartZoom = state.zoom;
  }
});

bookViewport.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (isPinching && activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const dist = pointDistance(pts[0], pts[1]);
    setZoom(gestureStartZoom * (dist / gestureStartDistance), false);
    e.preventDefault();
    return;
  }

  if (activePointers.size === 1 && singlePointerStart && state.zoom > 1.01) {
    state.panX = singlePointerStart.panX + (e.clientX - singlePointerStart.x);
    state.panY = singlePointerStart.panY + (e.clientY - singlePointerStart.y);
    bookStage.classList.add('panning');
    applyStageTransform();
  }
});

function endGesture(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) isPinching = false;
  if (activePointers.size > 0 || !singlePointerStart) return;

  const start = singlePointerStart;
  singlePointerStart = null;
  bookStage.classList.remove('panning');

  const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
  const isTap = dist < 10;

  if (isTap) {
    const now = Date.now();
    const isDoubleTap = lastTapPos && (now - lastTapTime) < 350 && pointDistance(lastTapPos, { x: e.clientX, y: e.clientY }) < 40;
    if (isDoubleTap) {
      setZoom(state.zoom > 1.01 ? 1 : Math.min(2, getMaxZoom()));
      lastTapTime = 0;
      lastTapPos = null;
      return;
    }
    lastTapTime = now;
    lastTapPos = { x: e.clientX, y: e.clientY };
  }
}
bookViewport.addEventListener('pointerup', endGesture);
bookViewport.addEventListener('pointercancel', endGesture);

// ---------------------------------------------------------------------
// Price search (top-center label + sheet) and product search (bottom
// sheet), both driving the live-DB result count / excel export.
// ---------------------------------------------------------------------
const productSearchInput = document.getElementById('productSearchInput');
const budgetMin = document.getElementById('budgetMin');
const budgetMax = document.getElementById('budgetMax');
const budgetError = document.getElementById('budgetError');
const btnBudgetSearch = document.getElementById('btnBudgetSearch');
const btnBudgetReset = document.getElementById('btnBudgetReset');
const btnPriceSearch = document.getElementById('btnPriceSearch');
const resultCountText = document.getElementById('resultCountText');
const btnExportExcel = document.getElementById('btnExportExcel');

let exportQueryString = '';

function formatBudgetInput(el) {
  const digits = el.value.replace(/[^0-9]/g, '');
  el.value = digits ? Number(digits).toLocaleString() : '';
}

function parseBudgetValue(el) {
  const digits = el.value.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : null;
}

budgetMin.addEventListener('input', () => formatBudgetInput(budgetMin));
budgetMax.addEventListener('input', () => formatBudgetInput(budgetMax));

function updatePriceSearchLabel() {
  const budget = state.budgetFilter;
  if (!budget) {
    btnPriceSearch.textContent = '예산으로 상품 찾기';
    btnPriceSearch.classList.remove('active');
    return;
  }
  btnPriceSearch.classList.add('active');
  if (budget.min !== null && budget.max !== null) {
    btnPriceSearch.textContent = `${formatPrice(budget.min)} ~ ${formatPrice(budget.max)}`;
  } else if (budget.min !== null) {
    btnPriceSearch.textContent = `${formatPrice(budget.min)} 이상`;
  } else {
    btnPriceSearch.textContent = `${formatPrice(budget.max)} 이하`;
  }
}

function currentFilterParams() {
  const params = new URLSearchParams();
  const q = productSearchInput.value.trim();
  if (q) params.set('search', q);
  if (state.budgetFilter) {
    if (state.budgetFilter.min !== null) params.set('minPrice', state.budgetFilter.min);
    if (state.budgetFilter.max !== null) params.set('maxPrice', state.budgetFilter.max);
  }
  return params;
}

async function updateExportUI() {
  const params = currentFilterParams();
  const isFiltered = params.toString() !== '';
  exportQueryString = params.toString();
  btnExportExcel.textContent = isFiltered ? '조회 상품 엑셀 다운로드' : '전체 상품 엑셀 다운로드';

  try {
    const res = await fetch(`/api/products?${exportQueryString}`);
    const data = await res.json();
    resultCountText.textContent = `조회 결과: ${(data.products || []).length}개`;
  } catch {
    resultCountText.textContent = '조회 결과: -';
  }
}

btnExportExcel.addEventListener('click', () => {
  window.location.href = `/api/products/export?${exportQueryString}`;
});

document.getElementById('btnPriceSearch').addEventListener('click', () => openSheet(document.getElementById('priceSearchSheet')));

btnBudgetSearch.addEventListener('click', () => {
  const min = parseBudgetValue(budgetMin);
  const max = parseBudgetValue(budgetMax);
  if (min !== null && max !== null && min > max) {
    budgetError.textContent = '최소 금액이 최대 금액보다 클 수 없습니다.';
    budgetError.style.display = '';
    return;
  }
  budgetError.style.display = 'none';
  state.budgetFilter = (min !== null || max !== null) ? { min, max } : null;
  updatePriceSearchLabel();
  updateExportUI();
  closeSheet();
});

btnBudgetReset.addEventListener('click', () => {
  budgetMin.value = '';
  budgetMax.value = '';
  budgetError.style.display = 'none';
  state.budgetFilter = null;
  updatePriceSearchLabel();
  updateExportUI();
  closeSheet();
});

document.getElementById('btnProductSearch').addEventListener('click', () => updateExportUI());
productSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') updateExportUI();
});
document.getElementById('btnProductSearchReset').addEventListener('click', () => {
  productSearchInput.value = '';
  updateExportUI();
});
document.getElementById('btnProductSearchToggle').addEventListener('click', () => {
  openSheet(document.getElementById('productSearchSheet'));
});

// Cart
function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveCart(cart) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function findProductById(id) {
  for (const cat of state.catalog.categories) {
    const found = cat.products.find((p) => p.id === id);
    if (found) return found;
  }
  return null;
}

function addToCart(productId) {
  const product = findProductById(productId);
  if (!product) return;
  const cart = loadCart();
  const existing = cart.find((item) => item.productId === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      productId,
      productCode: product.productCode,
      name: product.name,
      unitPrice: product.salePrice,
      quantity: 1,
    });
  }
  saveCart(cart);
  renderCart();
  openCart();
}

function renderCart() {
  const cart = loadCart();
  const cartItems = document.getElementById('cartItems');
  const cartCount = document.getElementById('cartCount');
  const cartTotal = document.getElementById('cartTotal');

  cartCount.textContent = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (!cart.length) {
    cartItems.innerHTML = '<p style="color:#94a3b8;font-size:0.85rem">담긴 상품이 없습니다.</p>';
  } else {
    cartItems.innerHTML = cart.map((item) => `
      <div class="cart-item" data-id="${item.productId}">
        <div style="flex:1">
          <div>${escapeHtml(item.name)}</div>
          <div style="color:#94a3b8">${formatPrice(item.unitPrice)}</div>
        </div>
        <input type="number" min="1" value="${item.quantity}" data-qty="${item.productId}" />
        <button type="button" class="icon-btn" style="background:#fee2e2;color:#991b1b" data-remove="${item.productId}">삭제</button>
      </div>`).join('');
  }

  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  cartTotal.textContent = formatPrice(total);
}

document.getElementById('cartItems').addEventListener('change', (e) => {
  if (e.target.dataset.qty) {
    const cart = loadCart();
    const item = cart.find((i) => i.productId === Number(e.target.dataset.qty));
    if (item) {
      item.quantity = Math.max(1, Number(e.target.value) || 1);
      saveCart(cart);
      renderCart();
    }
  }
});

document.getElementById('cartItems').addEventListener('click', (e) => {
  const removeId = e.target.dataset.remove;
  if (removeId) {
    const cart = loadCart().filter((i) => i.productId !== Number(removeId));
    saveCart(cart);
    renderCart();
  }
});

function openCart() {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
}
function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
}
document.getElementById('btnCart').addEventListener('click', openCart);
document.getElementById('btnCloseCart').addEventListener('click', closeCart);
document.getElementById('cartOverlay').addEventListener('click', closeCart);

document.getElementById('btnGenerateQuote').addEventListener('click', async () => {
  const cart = loadCart();
  if (!cart.length) {
    alert('담긴 상품이 없습니다.');
    return;
  }
  const customerCompany = document.getElementById('quoteCustomerCompany').value;
  const customerName = document.getElementById('quoteCustomerName').value;
  const customerContact = document.getElementById('quoteCustomerContact').value;

  const res = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      catalogId: catalogId ? Number(catalogId) : null,
      customerCompany,
      customerName,
      customerContact,
      items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || '견적서 생성에 실패했습니다.');
    return;
  }
  saveCart([]);
  renderCart();
  window.open(`/catalog/quote.html?id=${data.quote.id}`, '_blank');
});

// Kakao share
function initKakaoSdk() {
  const kakaoKey = window.APP_CONFIG && window.APP_CONFIG.KAKAO_JS_KEY;
  if (!kakaoKey) return;
  const script = document.createElement('script');
  script.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
  script.crossOrigin = 'anonymous';
  script.onload = () => {
    try {
      if (window.Kakao && !window.Kakao.isInitialized()) {
        window.Kakao.init(kakaoKey);
      }
    } catch (err) {
      console.error('Kakao init failed', err);
    }
  };
  document.head.appendChild(script);
}

function shareViaKakao() {
  if (!window.Kakao || !window.Kakao.isInitialized()) {
    alert('카카오 공유 기능이 설정되지 않았습니다.');
    return;
  }
  window.Kakao.Share.sendDefault({
    objectType: 'feed',
    content: {
      title: state.catalog.mainTitle,
      description: state.catalog.seasonName || 'B2B 카탈로그',
      imageUrl: state.catalog.coverImageUrl || '',
      link: {
        mobileWebUrl: window.location.href,
        webUrl: window.location.href,
      },
    },
  });
}

function shareViaEmail() {
  const subject = encodeURIComponent(state.catalog.mainTitle || '카탈로그 공유');
  const body = encodeURIComponent(`카탈로그를 확인해보세요:\n${window.location.href}`);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

async function shareViaCopyLink(button) {
  const url = window.location.href;
  const originalLabel = button.textContent;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const temp = document.createElement('textarea');
      temp.value = url;
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    button.textContent = '복사됨!';
  } catch {
    button.textContent = '복사 실패';
  }
  setTimeout(() => { button.textContent = originalLabel; }, 1500);
}

let qrLibraryPromise = null;
function loadQrLibrary() {
  if (window.QRCode) return Promise.resolve();
  if (!qrLibraryPromise) {
    qrLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  return qrLibraryPromise;
}

async function shareViaQr() {
  const container = document.getElementById('qrContainer');
  container.style.display = 'flex';
  container.innerHTML = '생성 중...';
  try {
    await loadQrLibrary();
    container.innerHTML = '';
    // eslint-disable-next-line no-new
    new window.QRCode(container, {
      text: window.location.href,
      width: 160,
      height: 160,
    });
  } catch {
    container.innerHTML = 'QR코드를 생성할 수 없습니다.';
  }
}

document.querySelectorAll('#shareSheet [data-share]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.share;
    if (type === 'kakao') shareViaKakao();
    else if (type === 'email') shareViaEmail();
    else if (type === 'copy') shareViaCopyLink(btn);
    else if (type === 'qr') shareViaQr();
  });
});

// ---------------------------------------------------------------------
// Settings (dark mode / auto-fit / rotation lock)
// ---------------------------------------------------------------------
const SETTINGS_STORAGE_KEY = 'b2bCatalogSettings';
const settingDarkMode = document.getElementById('settingDarkMode');
const settingAutoFit = document.getElementById('settingAutoFit');

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
    if (saved && typeof saved === 'object') Object.assign(state.settings, saved);
  } catch {
    // ignore malformed storage
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function applySettingsToUI() {
  document.documentElement.dataset.theme = state.settings.darkMode ? 'dark' : 'light';
  settingDarkMode.checked = state.settings.darkMode;
  settingAutoFit.checked = state.settings.autoFit;
}

settingDarkMode.addEventListener('change', () => {
  state.settings.darkMode = settingDarkMode.checked;
  applySettingsToUI();
  saveSettings();
});
settingAutoFit.addEventListener('change', () => {
  state.settings.autoFit = settingAutoFit.checked;
  saveSettings();
});

document.getElementById('btnRotationLock').addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('portrait');
      alert('화면 회전이 잠금되었습니다.');
    } else {
      throw new Error('unsupported');
    }
  } catch {
    alert('이 기기/브라우저에서는 화면 회전 잠금을 지원하지 않습니다. (iPhone Safari는 지원하지 않습니다)');
  }
});

// ---------------------------------------------------------------------
// More menu: settings / fullscreen / PDF / print
// ---------------------------------------------------------------------
document.querySelectorAll('#moreSheet [data-more]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.more;
    if (action === 'help') {
      openSheet(document.getElementById('helpSheet'));
    } else if (action === 'settings') {
      openSheet(document.getElementById('settingsSheet'));
    } else if (action === 'fullscreen') {
      closeSheet();
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    } else if (action === 'pdf' || action === 'print') {
      closeSheet();
      triggerPrint();
    }
  });
});

function buildPrintContainer() {
  const container = document.getElementById('printContainer');
  container.innerHTML = state.pages.map((pageData) => `
    <div class="print-page">${pageHtml(pageData)}</div>
  `).join('');
}

function triggerPrint() {
  buildPrintContainer();
  window.print();
}

// ---------------------------------------------------------------------
// Thumbnail panel
// ---------------------------------------------------------------------
function pageLabel(pageData) {
  if (pageData.type === 'cover') return '표지';
  if (pageData.type === 'toc') return '목차';
  if (pageData.type === 'back') return '주문안내';
  if (pageData.type === 'categoryGrid') return pageData.category;
  if (pageData.type === 'product') return pageData.product.name;
  return '';
}

function pageThumbImage(pageData) {
  if (pageData.type === 'product') return pageData.product.imageUrl;
  if (pageData.type === 'categoryGrid' && pageData.products.length) return pageData.products[0].imageUrl;
  return null;
}

function renderThumbnails(filter = '') {
  const grid = document.getElementById('thumbnailGrid');
  const current = state.currentPageIndex + 1;
  const q = filter.trim().toLowerCase();

  const items = state.pages
    .map((pageData, index) => ({ pageData, index, label: pageLabel(pageData) }))
    .filter(({ index, label }) => {
      if (!q) return true;
      if (String(index + 1) === q) return true;
      return label.toLowerCase().includes(q);
    });

  grid.innerHTML = items.map(({ pageData, index, label }) => {
    const img = pageThumbImage(pageData);
    return `
      <div class="thumb-card ${index + 1 === current ? 'current' : ''}" data-goto-thumb="${index + 1}">
        <div class="thumb-preview">${img ? `<img src="${img}" onerror="this.src='/assets/no-image.svg'" />` : escapeHtml(label)}</div>
        <div class="thumb-page-no">${index + 1}</div>
      </div>`;
  }).join('') || '<div class="no-results">검색 결과가 없습니다.</div>';
}

document.getElementById('thumbnailGrid').addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto-thumb]');
  if (!el) return;
  goToPage(Number(el.dataset.gotoThumb));
  closeSheet();
});

document.getElementById('thumbnailSearch').addEventListener('input', (e) => renderThumbnails(e.target.value));

// ---------------------------------------------------------------------
// TOC panel
// ---------------------------------------------------------------------
function renderTocPanel(filter = '') {
  const list = document.getElementById('tocPanelList');
  const q = filter.trim().toLowerCase();
  const entries = state.tocEntries.filter((e) => !q || e.category.toLowerCase().includes(q));
  list.innerHTML = entries.map((e) => `
    <li data-goto-toc="${e.page}"><span>${escapeHtml(e.category)}</span><span>${e.page}</span></li>
  `).join('') || '<div class="no-results">검색 결과가 없습니다.</div>';
}

document.getElementById('tocPanelList').addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto-toc]');
  if (!el) return;
  goToPage(Number(el.dataset.gotoToc));
  closeSheet();
});

document.getElementById('tocSearch').addEventListener('input', (e) => renderTocPanel(e.target.value));

// Keep the book viewport clear of the toolbar even as it grows to two rows
// (budget filter row) or wraps on narrow screens.
function syncToolbarHeight() {
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) {
    document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`);
  }
}

// Below this width, the book stays single-page (portrait); above it, a
// two-page spread. Must match minWidth in initPageFlip() (2×minWidth=860)
// so PageFlip's own orientation switch and our sizing agree on the same
// breakpoint.
const SPREAD_BREAKPOINT = 860;
const PAGE_RATIO = 660 / 860;

// Computes the exact pixel box PageFlip should render at: the largest
// size that (a) fits the space left after the toolbar/bottom bar and
// (b) keeps the same width:height ratio passed to `new St.PageFlip()`.
// Plain CSS (auto width/height + aspect-ratio + max-width/max-height)
// can't reliably resolve to that same answer once the container is a
// flex descendant with no definite width of its own to shrink-to-fit
// against, so this is done with real arithmetic instead.
function sizeBookFlip() {
  const isSingle = window.innerWidth <= SPREAD_BREAKPOINT;
  const toolbarH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h')) || 56;
  const bottomH = 56;
  const margin = isSingle ? 16 : 24;
  const maxH = Math.min(window.innerHeight - toolbarH - bottomH - margin, 860);
  const maxW = isSingle ? Math.min(window.innerWidth * 0.94, 660) : 1320;
  const ratio = isSingle ? PAGE_RATIO : PAGE_RATIO * 2;

  const w = Math.min(maxW, maxH * ratio);
  // Sized on #bookStage, not #bookFlip itself — PageFlip's own "autoSize"
  // handling (on by default) sets #bookFlip's width to 100% of ITS parent
  // and derives height internally from that via a padding-bottom percent
  // trick using the settings ratio, so anything set directly on #bookFlip
  // just gets overwritten. Giving the parent a definite pixel width is
  // what "100%" needs to resolve to the right answer.
  bookStage.style.width = `${w}px`;
}

function syncLayout() {
  syncToolbarHeight();
  sizeBookFlip();
}
window.addEventListener('resize', syncLayout);
syncLayout();

// Init
async function init() {
  loadSettings();
  applySettingsToUI();

  if (!catalogId) {
    loadingScreen.textContent = '카탈로그 ID가 지정되지 않았습니다.';
    return;
  }
  try {
    const res = await fetch(`/api/catalogs/${catalogId}`);
    if (!res.ok) throw new Error('카탈로그를 불러올 수 없습니다.');
    const data = await res.json();
    state.catalog = data.catalog;
    const built = buildPages(state.catalog);
    state.pages = built.pages;
    state.productPageIndex = built.productPageIndex;
    state.tocEntries = built.tocEntries;

    initPageFlip();
    const initialPage = Number(params.get('page')) || 1;
    if (initialPage > 1) goToPage(initialPage);
    renderCart();
    updateExportUI();
    initKakaoSdk();
    loadingScreen.classList.add('hidden');
  } catch (err) {
    loadingScreen.textContent = err.message || '오류가 발생했습니다.';
  }
}

init();
