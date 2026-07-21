const PRODUCTS_PER_GRID_PAGE = 6;
const CART_STORAGE_KEY = 'b2bCatalogCart';

const state = {
  catalog: null,
  pages: [],
  productPageIndex: {},
  searchIndex: [],
  currentSpreadIndex: 0,
  currentMobilePage: 0,
  zoom: 1,
};

const params = new URLSearchParams(window.location.search);
const catalogId = params.get('id');

const bookSpread = document.getElementById('bookSpread');
const bookStage = document.getElementById('bookStage');
const pageInput = document.getElementById('pageInput');
const totalPagesEl = document.getElementById('totalPages');
const loadingScreen = document.getElementById('loadingScreen');

function isDesktop() {
  return window.matchMedia('(min-width: 861px)').matches;
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

  pages[tocPageIndex].entries = catalog.categories.map((c) => ({
    category: c.category,
    page: categoryStartPage[c.category] + 1,
  }));

  return { pages, productPageIndex };
}

function buildSearchIndex(catalog) {
  const index = [];
  catalog.categories.forEach((catEntry) => {
    catEntry.products.forEach((p) => {
      index.push({
        id: p.id,
        name: p.name,
        productCode: p.productCode,
        category: catEntry.category,
        imageUrl: p.imageUrl,
      });
    });
  });
  return index;
}

function pageHtml(pageData) {
  const catalog = state.catalog;
  if (!pageData) return '<div class="page blank"></div>';

  switch (pageData.type) {
    case 'cover':
      return `
        <div class="page single">
          <div class="page-cover">
            <div>
              <div class="brand-row">
                ${catalog.companyLogoUrl ? `<img src="${catalog.companyLogoUrl}" alt="logo" />` : ''}
              </div>
              ${catalog.seasonName ? `<div class="season">${escapeHtml(catalog.seasonName)}</div>` : ''}
            </div>
            <div class="cover-image" style="background-image:url('${catalog.coverImageUrl || ''}')"></div>
            <div>
              <div class="main-title">${escapeHtml(catalog.mainTitle)}</div>
              <div class="subtitle">PREMIUM · GIFT · GUIDE · BOOK</div>
              ${catalog.clientName ? `
                <div class="client-tag" style="margin-top:0.9rem">
                  ${catalog.clientLogoUrl ? `<img src="${catalog.clientLogoUrl}" alt="client" />` : ''}
                  <span>${escapeHtml(catalog.clientName)} 전용 카탈로그</span>
                </div>` : ''}
            </div>
          </div>
        </div>`;

    case 'toc':
      return `
        <div class="page left">
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
        <div class="page right">
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
        <div class="page left product-detail">
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
        <div class="page right back-page">
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

function maxSpreadIndex() {
  return Math.floor(state.pages.length / 2);
}

function renderSpread() {
  const total = state.pages.length;
  if (isDesktop()) {
    const s = state.currentSpreadIndex;
    const leftIndex = 2 * s - 1;
    const rightIndex = 2 * s;
    const leftPage = leftIndex >= 0 && leftIndex < total ? state.pages[leftIndex] : null;
    const rightPage = rightIndex < total ? state.pages[rightIndex] : null;
    bookSpread.innerHTML = pageHtml(leftPage) + pageHtml(rightPage);
    const shown = rightPage ? rightIndex + 1 : leftIndex + 1;
    pageInput.value = shown;
  } else {
    const idx = Math.min(Math.max(state.currentMobilePage, 0), total - 1);
    bookSpread.innerHTML = pageHtml(state.pages[idx]);
    pageInput.value = idx + 1;
  }
  totalPagesEl.textContent = total;
}

function goToPage(oneBasedIndex) {
  const total = state.pages.length;
  const clamped = Math.min(Math.max(oneBasedIndex, 1), total);
  if (isDesktop()) {
    state.currentSpreadIndex = Math.floor(clamped / 2);
  } else {
    state.currentMobilePage = clamped - 1;
  }
  renderSpread();
}

function next() {
  if (isDesktop()) {
    state.currentSpreadIndex = Math.min(state.currentSpreadIndex + 1, maxSpreadIndex());
  } else {
    state.currentMobilePage = Math.min(state.currentMobilePage + 1, state.pages.length - 1);
  }
  renderSpread();
}

function prev() {
  if (isDesktop()) {
    state.currentSpreadIndex = Math.max(state.currentSpreadIndex - 1, 0);
  } else {
    state.currentMobilePage = Math.max(state.currentMobilePage - 1, 0);
  }
  renderSpread();
}

function first() {
  state.currentSpreadIndex = 0;
  state.currentMobilePage = 0;
  renderSpread();
}

function last() {
  state.currentSpreadIndex = maxSpreadIndex();
  state.currentMobilePage = state.pages.length - 1;
  renderSpread();
}

bookSpread.addEventListener('click', (e) => {
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
pageInput.addEventListener('change', () => goToPage(Number(pageInput.value)));
window.addEventListener('resize', renderSpread);

// Zoom
function applyZoom() {
  bookStage.style.transform = `scale(${state.zoom})`;
  document.getElementById('btnZoomReset').textContent = `${Math.round(state.zoom * 100)}%`;
}
document.getElementById('btnZoomIn').addEventListener('click', () => {
  state.zoom = Math.min(state.zoom + 0.15, 2);
  applyZoom();
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
  state.zoom = Math.max(state.zoom - 0.15, 0.6);
  applyZoom();
});
document.getElementById('btnZoomReset').addEventListener('click', () => {
  state.zoom = 1;
  applyZoom();
});

// Search
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    searchResults.classList.remove('open');
    searchResults.innerHTML = '';
    return;
  }
  const matches = state.searchIndex.filter((item) =>
    item.name.toLowerCase().includes(q) ||
    (item.productCode || '').toLowerCase().includes(q) ||
    item.category.toLowerCase().includes(q)
  ).slice(0, 20);

  if (!matches.length) {
    searchResults.innerHTML = '<div class="search-result-item">검색 결과가 없습니다.</div>';
  } else {
    searchResults.innerHTML = matches.map((m) => `
      <div class="search-result-item" data-goto="${state.productPageIndex[m.id] + 1}">
        <img src="${m.imageUrl}" onerror="this.src='/assets/no-image.svg'" />
        <div>
          <div>${escapeHtml(m.name)}</div>
          <div style="color:#94a3b8">${escapeHtml(m.category)} · ${escapeHtml(m.productCode || '')}</div>
        </div>
      </div>`).join('');
  }
  searchResults.classList.add('open');
});

searchResults.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto]');
  if (!el) return;
  goToPage(Number(el.dataset.goto));
  searchResults.classList.remove('open');
  searchInput.value = '';
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) searchResults.classList.remove('open');
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

document.getElementById('btnShare').addEventListener('click', () => {
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
});

// Init
async function init() {
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
    state.searchIndex = buildSearchIndex(state.catalog);

    const initialPage = Number(params.get('page')) || 1;
    goToPage(initialPage);
    renderCart();
    initKakaoSdk();
    loadingScreen.classList.add('hidden');
  } catch (err) {
    loadingScreen.textContent = err.message || '오류가 발생했습니다.';
  }
}

init();
