const CART_STORAGE_KEY = 'b2bCatalogCart';

const state = {
  catalog: null,
  pages: [],
  tocEntries: [],
  currentPageIndex: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
  soloOffsetX: 0,
  budgetFilter: null,
  chromeHidden: false,
  settings: {
    darkMode: true,
    autoFit: true,
  },
};

const params = new URLSearchParams(window.location.search);
const catalogId = params.get('id');

const bookViewport = document.getElementById('bookViewport');
// Reassigned when PageFlip is torn down and rebuilt with a different page
// ratio on crossing SPREAD_BREAKPOINT — see ensurePageFlipMode().
let bookFlipEl = document.getElementById('bookFlip');
const bookStage = document.getElementById('bookStage');
const pageCurrentText = document.getElementById('pageCurrentText');
const totalPagesEl = document.getElementById('totalPages');
const pageCurrentTextMobile = document.getElementById('pageCurrentTextMobile');
const totalPagesElMobile = document.getElementById('totalPagesMobile');
const loadingScreen = document.getElementById('loadingScreen');

let pageFlip = null;

function getMaxZoom() {
  return (state.catalog && state.catalog.maxZoom) || 3;
}

function clampZoom(z) {
  return Math.min(getMaxZoom(), Math.max(1, z));
}

// Discrete zoom-button steps (1 / 1.5 / 2 / 2.5 / 3 ...), capped at the
// catalog's admin-configured max zoom so a lower max_zoom (e.g. 1.5) still
// produces a valid, non-empty step list. Pinch-zoom stays continuous (see
// the pointermove handler below) - only the +/- buttons snap to these.
function getZoomSteps() {
  const max = getMaxZoom();
  const steps = [1];
  for (let s = 1.5; s < max - 0.001; s += 0.5) steps.push(Math.round(s * 100) / 100);
  if (max > 1.001) steps.push(Math.round(max * 100) / 100);
  return steps;
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks.length ? chunks : [[]];
}

// Admin-configured per-category page sizes (4 or 6 products per page) are
// consumed greedily front-to-back in display-order: page N gets the next
// configuredSizes[N] products (or 6 if that page has no configured size,
// e.g. because products were added after the layout was last saved). Any
// configured sizes left over once every product is placed are simply
// unused — no empty trailing pages are ever created.
function chunkByLayout(arr, configuredSizes) {
  const chunks = [];
  let i = 0;
  let pageIdx = 0;
  while (i < arr.length) {
    const configured = Array.isArray(configuredSizes) ? configuredSizes[pageIdx] : undefined;
    const capacity = configured === 3 || configured === 4 || configured === 6 ? configured : 6;
    chunks.push({ capacity, products: arr.slice(i, i + capacity) });
    i += capacity;
    pageIdx += 1;
  }
  return chunks.length ? chunks : [{ capacity: 6, products: [] }];
}

function formatPrice(value) {
  return `${Number(value).toLocaleString()}원`;
}

// Catalog product tiles use a "₩34,900" prefix style instead of the
// "34,900원" suffix style used everywhere else (search results, cart,
// price-search label) - kept as its own formatter so this one tile's look
// doesn't change formatting anywhere else in the app.
function formatTilePrice(value) {
  return `₩${Number(value).toLocaleString()}`;
}

function buildPages(catalog) {
  const pages = [];
  const categoryStartPage = {};
  const searchIndex = [];

  pages.push({ type: 'cover' });
  pages.push({ type: 'orderGuide' });
  pages.push({ type: 'packagingInfo' });
  const tocPageIndex = pages.length;
  pages.push({ type: 'toc', entries: [] });

  catalog.categories.forEach((catEntry) => {
    categoryStartPage[catEntry.category] = pages.length;
    const configuredSizes = catalog.pageLayout && catalog.pageLayout[catEntry.category];
    const chunks = chunkByLayout(catEntry.products, configuredSizes);
    chunks.forEach((chunk, chunkIdx) => {
      const pageNumber = pages.length + 1;
      chunk.products.forEach((p) => {
        searchIndex.push({ product: p, category: catEntry.category, page: pageNumber });
      });
      pages.push({
        type: 'categoryGrid',
        category: catEntry.category,
        partIndex: chunkIdx,
        partTotal: chunks.length,
        capacity: chunk.capacity,
        products: chunk.products,
      });
    });
  });

  // PageFlip only isolates the very first ("cover") page unconditionally;
  // whether the very last page also lands alone on its own spread instead
  // of pairing up depends purely on whether the total page count comes out
  // even. Padding with one blank filler when needed guarantees the back
  // cover always gets its own centered page, regardless of how many
  // category/grid pages came before it.
  if (pages.length % 2 === 0) pages.push({ type: 'blank' });
  pages.push({ type: 'back' });

  const tocEntries = catalog.categories.map((c) => ({
    category: c.category,
    page: categoryStartPage[c.category] + 1,
  }));
  pages[tocPageIndex].entries = tocEntries;

  return { pages, tocEntries, searchIndex };
}

// A cover image is treated as the finished, fully-designed cover/back-cover
// (title/greeting/CTA already baked into the artwork), rendered as-is with
// no text overlay. The optional download hotspot lets a real click land on
// the baked-in "상품리스트 다운로드" button area at the bottom of the image.
function coverImageHtml(imageUrl, { withDownloadHotspot = false } = {}) {
  return `
    <div class="cover-image-wrap">
      <img src="${imageUrl}" alt="표지" />
      ${withDownloadHotspot ? '<button type="button" class="cover-download-hotspot" data-cover-download aria-label="상품리스트 다운로드"></button>' : ''}
    </div>`;
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
            ${coverImageHtml(catalog.coverImageUrl, { withDownloadHotspot: true })}
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

    case 'orderGuide':
      return `
        <div class="page order-guide-page">
          <div class="og-section">
            <div class="og-header">📞 주문 및 상담 안내</div>
            <ul class="og-info-list">
              <li>✔ 상담센터(상품문의, 주문, 결제 등) : 1661-9978</li>
              <li>✔ 배송 리스트 접수 : md@fosla.co.kr</li>
              <li>✔ 대량 주문시 할인 드립니다</li>
            </ul>
            <div class="og-qr-box">
              <img class="og-qr-code" src="/assets/order-guide-qr.png" alt="추석선물 전체 상품보기 QR코드" />
              <div class="og-qr-text">
                추석선물 전체 상품보기<br />
                URL: event.fosla.co.kr<br />
                ID/PW: guest / 1111
              </div>
            </div>
          </div>
          <div class="og-section">
            <div class="og-header">💬 구매전 주의사항</div>
            <div class="og-qa-list">
              <div class="og-qa">
                <div class="og-q"><span class="og-q-mark">Q</span>주문 기한은 언제까지인가요?</div>
                <div class="og-a"><span class="og-a-mark">A</span>2026년 09월 18일 오후 1시까지 접수 가능합니다.<br />※ 상품은 조기에 품절될 수 있습니다.(전화수령)</div>
              </div>
              <div class="og-qa">
                <div class="og-q"><span class="og-q-mark">Q</span>상품 가격은 택배비 포함인가요?</div>
                <div class="og-a"><span class="og-a-mark">A</span>네! 상품 가격은 포장과 택배비가 포함된 금액입니다.</div>
              </div>
              <div class="og-qa">
                <div class="og-q"><span class="og-q-mark">Q</span>주문은 어떻게 진행하나요?</div>
                <div class="og-a"><span class="og-a-mark">A</span>상품번호, 상품명, 보내시는분, 받으시는분(이름/주소/연락처)를 확인하신 후 md@fosla.co.kr로 메일 발송 요청드립니다. 주문서를 확인한 후, 순차적으로 주문 확인 연락을 드립니다.</div>
              </div>
              <div class="og-qa">
                <div class="og-q"><span class="og-q-mark">Q</span>주문한 선물의 배송 결과는 어떻게 확인하나요?</div>
                <div class="og-a"><span class="og-a-mark">A</span>출고 담당자가 하루 두번 이상 배송 상황을 확인하며, 문제가 발생한 주문은 즉시 안내드립니다.</div>
              </div>
              <div class="og-qa">
                <div class="og-q"><span class="og-q-mark">Q</span>결제는 언제 어떻게 진행하나요?</div>
                <div class="og-a"><span class="og-a-mark">A</span>네! 주문하면서 직접 결제를 하셔도 되고, 배송 후 또는 명절 이후 상담센터(1661-9978)를 통해 결제하셔도 됩니다.</div>
              </div>
            </div>
          </div>
        </div>`;

    case 'packagingInfo':
      return `
        <div class="page packaging-info-page">
          <div class="pi-section">
            <div class="pi-header">명절 스티커</div>
            <div class="pi-body">
              <div class="pi-text">✔ 선물 보내시는분의 감사 스티커를 부착해 드립니다.<br />9.9cm x 9.3cm의 스티커가 부착됩니다.</div>
              <div class="pi-sample pi-sticker-sample">
                <div class="pi-sticker-card">
                  <div class="pi-sticker-title">풍요로운 추석<br />행복한 한가위 되세요</div>
                  <div class="pi-sticker-name">○ ○ ○ 올림</div>
                </div>
                <div class="pi-sample-size">9.9cm x 9.3cm</div>
              </div>
            </div>
          </div>
          <div class="pi-section">
            <div class="pi-header">택배 송장</div>
            <div class="pi-body">
              <div class="pi-text">✔ 택배 송장의 배송 메모에 보내는 분이 기재됩니다.</div>
              <div class="pi-sample pi-invoice-sample">
                <div class="pi-invoice-card">
                  <div class="pi-invoice-row pi-invoice-memo">배송 메모: ○ ○ ○ 님이 보내신 선물입니다</div>
                  <div class="pi-invoice-row pi-invoice-addr">받는분 주소 / 연락처</div>
                </div>
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

    case 'categoryGrid': {
      const capacity = pageData.capacity === 3 || pageData.capacity === 4 ? pageData.capacity : 6;
      return `
        <div class="page">
          <div class="category-banner">
            <h2>${escapeHtml(pageData.category)}${pageData.partTotal > 1 ? ` (${pageData.partIndex + 1}/${pageData.partTotal})` : ''}</h2>
          </div>
          <div class="product-grid product-grid-${capacity}">
            ${pageData.products.map((p) => `
              <div class="product-tile">
                ${p.productCode ? `<div class="tile-code">${escapeHtml(p.productCode)}</div>` : ''}
                <div class="image-frame">
                  ${productImageHtml(p)}
                  ${promoStampHtml(p.promoBadge)}
                </div>
                ${catalog.showPrice ? `
                  <div class="price-badge">
                    ${p.originalPrice ? `<span class="original">${formatPrice(p.originalPrice)}</span>` : ''}
                    ${formatTilePrice(p.salePrice)}
                  </div>` : ''}
                <div class="tile-name">${escapeHtml(p.name)}</div>
                <div class="tile-meta">${escapeHtml([p.composition, p.features].filter(Boolean).join(' · '))}</div>
                <button class="btn-add-cart" data-add-cart="${p.id}">견적 담기</button>
              </div>`).join('')}
          </div>
        </div>`;
    }

    case 'back':
      if (catalog.backCoverImageUrl) {
        return `
          <div class="page" data-density="hard">
            ${coverImageHtml(catalog.backCoverImageUrl)}
          </div>`;
      }
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

// Prefers the auto-cropped (whitespace-trimmed) image when one exists,
// falling back to the original image_url both as the source (when no crop
// was produced) and as an onerror fallback (when a stored crop 404s).
// Manual admin zoom/pan is applied as a CSS transform inside the tile's
// overflow-hidden image frame.
function productImageHtml(p) {
  const src = p.croppedImageUrl || p.imageUrl;
  const fallback = p.imageUrl || '';
  const zoom = Number(p.imageZoom) || 1;
  const offsetX = Number(p.imageOffsetX) || 0;
  const offsetY = Number(p.imageOffsetY) || 0;
  const transform = (zoom !== 1 || offsetX !== 0 || offsetY !== 0)
    ? ` style="transform: translate(${offsetX}%, ${offsetY}%) scale(${zoom});"`
    : '';
  return `<img src="${src}" data-fallback="${fallback}" onerror="if (this.dataset.fallback && this.src !== this.dataset.fallback) { this.src = this.dataset.fallback; } else { this.onerror = null; this.src = '/assets/no-image.svg'; }" alt="${escapeHtml(p.name)}"${transform} />`;
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
  pageCurrentTextMobile.textContent = oneBasedPage;
  totalPagesElMobile.textContent = total;
  resetPan();
  if (state.settings.autoFit) setZoom(1, false);
  updateSoloCentering();
}

// width:height must match the .book-flip aspect-ratio exactly — PageFlip's
// "stretch" mode derives its internal page geometry from this ratio, and
// any mismatch against the container's real rendered ratio leaves gaps
// and breaks its own drag/corner hit-testing (see the CSS comment).
// Three modes, each its own ratio:
//  - 'phone': true phone widths get a much taller/narrower ratio than a
//    spread book page, matching a phone screen's own aspect far more
//    closely so the page fills nearly the whole screen height instead of
//    leaving empty space above/below it.
//  - 'tabletSingle': single-page mode above phone width (portrait
//    tablets) keeps the original book-like ratio — reusing the 'phone'
//    ratio there would force the page narrower than the screen actually
//    allows, since a fixed ratio's width is capped by the shorter of
//    (available width) and (available height × ratio), and a tablet's
//    available height isn't enough to also justify a phone-narrow width.
//  - 'spread': unchanged, tablet-landscape/desktop two-page view.
// PageFlip has no live setter for this ratio, so switching between these
// tears the instance down and builds a fresh one (see ensurePageFlipMode()).
// (PHONE_MODE_BREAKPOINT is defined further down, next to getLayoutMode().)
// Phone mode's box isn't a fixed ratio like the other two modes — it's
// computed fresh from the actual available width AND height every time a
// 'phone'-mode PageFlip instance is (re)built, so the page's own ratio
// exactly matches whatever this specific device/viewport has room for.
// A fixed ratio (like tabletSingle/spread use) can only ever max out ONE
// dimension — whichever is tighter, width or height×ratio — leaving the
// other one short; letting the ratio itself be device-specific is what
// fills both edges at once. Recomputed on every mode-entry, so it doesn't
// track further resizes within the same 'phone' range (rotating to a
// width that's still <=480 is rare) — see ensurePageFlipMode().
function computePhoneBox() {
  const toolbarH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h')) || 50;
  const bottomH = 52;
  const margin = 6;
  const width = Math.round(Math.min(window.innerWidth * 0.98, 480));
  const height = Math.round(Math.min(window.innerHeight - toolbarH - bottomH - margin, 924));
  return { width, height };
}

function getPageFlipSettings(mode) {
  const base = {
    size: 'stretch',
    maxShadowOpacity: 0.5,
    showCover: true,
    usePortrait: true,
    mobileScrollSupport: true,
    // The cursor-follow "corner lift" hint (default on) made the whole book
    // visibly wobble any time the mouse moved over it, even with no click.
    showPageCorners: false,
  };
  if (mode === 'phone') {
    const { width, height } = computePhoneBox();
    phoneRatio = width / height;
    return {
      ...base,
      width,
      height,
      minWidth: Math.round(width * 0.6),
      maxWidth: width,
      minHeight: Math.round(height * 0.6),
      maxHeight: height,
    };
  }
  if (mode === 'tabletSingle') {
    return { ...base, width: 480, height: 626, minWidth: 430, maxWidth: 660, minHeight: 560, maxHeight: 860 };
  }
  // minWidth is set so the portrait/landscape switch (at 2×minWidth) lands
  // on the same 860px container width where SPREAD_BREAKPOINT itself
  // switches — otherwise there's a window-width range where the two
  // disagree and the gap/hit-test bug above comes right back.
  return { ...base, width: 480, height: 626, minWidth: 430, maxWidth: 660, minHeight: 560, maxHeight: 860 };
}

// PageFlip treats any mousedown/touchstart on a page as the start of a
// possible flip — including ones landing on a product tile, TOC entry, or
// the add-to-cart button. disableFlipByClick can't fix this without also
// breaking flipNext()/flipPrev() (both route through the same click gate),
// so instead the interactive elements themselves stop the press from ever
// reaching PageFlip's listener, in the capture phase, before it can start
// tracking a flip. The follow-up 'click' event is untouched and still
// reaches our own data-goto/data-add-cart handling below.
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, label, [data-goto], [data-add-cart], [data-cover-download], [data-no-pan]';
// Zoomed-in: every press on the book is a pan (or a tap on an interactive
// element), never a flip attempt - so PageFlip's own mousedown/touchstart
// listener (bound directly on this same element, see the vendor-bundle
// comment near ensurePageFlipMode()) must never see it either. Stopping
// propagation here, in the capture phase, keeps the event from ever
// reaching that bubble-phase listener at all.
function stopIfInteractive(e) {
  if (e.target.closest(INTERACTIVE_SELECTOR) || state.zoom > 1.01) e.stopPropagation();
}
function handleBookFlipClick(e) {
  const gotoEl = e.target.closest('[data-goto]');
  if (gotoEl) {
    goToPage(Number(gotoEl.dataset.goto));
    return;
  }
  const downloadEl = e.target.closest('[data-cover-download]');
  if (downloadEl) {
    triggerFullExport();
    return;
  }
  const addCartEl = e.target.closest('[data-add-cart]');
  if (addCartEl) {
    addToCart(Number(addCartEl.dataset.addCart));
  }
}
// Bound to whichever element bookFlipEl currently points at — called once
// at first load and again every time ensurePageFlipMode() replaces it.
function attachBookFlipListeners() {
  bookFlipEl.addEventListener('mousedown', stopIfInteractive, true);
  bookFlipEl.addEventListener('touchstart', stopIfInteractive, true);
  bookFlipEl.addEventListener('click', handleBookFlipClick);
}
attachBookFlipListeners();

// Builds (or, on a single<->spread crossing, tears down and rebuilds with
// the mode-appropriate ratio from getPageFlipSettings()) the PageFlip
// instance. A no-op while state.pages hasn't loaded yet, and a no-op if
// the mode hasn't actually changed since last time.
let pageFlipMode = null;
// Set by getPageFlipSettings() every time 'phone' mode is (re)built;
// sizeBookFlip() reads this back so its own math matches whatever ratio
// the live PageFlip instance actually has. Falls back to a reasonable
// phone-shaped ratio if sizeBookFlip somehow runs before that ever happens.
let phoneRatio = 480 / 924;
function ensurePageFlipMode() {
  if (!state.pages.length) return;
  const mode = getLayoutMode();
  if (mode === pageFlipMode) return;
  const wasInitialized = pageFlipMode !== null;
  const savedIndex = wasInitialized ? state.currentPageIndex : 0;
  pageFlipMode = mode;

  if (wasInitialized) {
    pageFlip.destroy();
    const fresh = document.createElement('div');
    fresh.id = 'bookFlip';
    fresh.className = 'book-flip';
    bookStage.appendChild(fresh);
    bookFlipEl = fresh;
    attachBookFlipListeners();
  }

  pageFlip = new St.PageFlip(bookFlipEl, getPageFlipSettings(mode));
  pageFlip.loadFromHTML(buildPageElements());
  pageFlip.on('flip', (e) => {
    state.currentPageIndex = e.data;
    updateNavUI(e.data + 1);
  });
  if (wasInitialized) pageFlip.turnToPage(savedIndex);
  updateNavUI(savedIndex + 1);
}

function goToPage(oneBasedIndex) {
  const total = state.pages.length;
  const clamped = Math.min(Math.max(oneBasedIndex, 1), total);
  pageFlip.turnToPage(clamped - 1);
  state.currentPageIndex = clamped - 1;
  updateNavUI(clamped);
}

// Resetting zoom and flipping in the very same tick raced PageFlip's own
// flip-start geometry measurement against the book-stage's own zoom-out
// transition (still mid-transform at that instant), sometimes producing a
// wrong/no-op flip. Letting the zoom-reset transition finish first (it
// matches .book-stage's own 0.25s transition) keeps the two animations
// sequential instead of visually and geometrically fighting each other.
function next() {
  if (state.zoom > 1.01) {
    setZoom(1);
    setTimeout(() => pageFlip.flipNext(), 260);
  } else {
    pageFlip.flipNext();
  }
}

function prev() {
  if (state.zoom > 1.01) {
    setZoom(1);
    setTimeout(() => pageFlip.flipPrev(), 260);
  } else {
    pageFlip.flipPrev();
  }
}

function first() {
  goToPage(1);
}

function last() {
  goToPage(state.pages.length);
}

document.getElementById('btnNext').addEventListener('click', next);
document.getElementById('btnPrev').addEventListener('click', prev);
document.getElementById('btnFirst').addEventListener('click', first);
document.getElementById('btnLast').addEventListener('click', last);
document.getElementById('btnNextMobile').addEventListener('click', next);
document.getElementById('btnPrevMobile').addEventListener('click', prev);

// ---------------------------------------------------------------------
// Shared bottom-sheet / float-bar system
// ---------------------------------------------------------------------
const sheetOverlay = document.getElementById('sheetOverlay');
const allSheets = Array.from(document.querySelectorAll('.bottom-sheet, .modal-popup'));
const allFloatBars = Array.from(document.querySelectorAll('.float-bar'));
let activeSheet = null;

function closeAllFloatBars() {
  allFloatBars.forEach((bar) => bar.classList.remove('open'));
}

function closeSheet() {
  if (activeSheet) activeSheet.classList.remove('open');
  activeSheet = null;
  sheetOverlay.classList.remove('open');
  sheetOverlay.classList.remove('overlay-light');
  // A sheet being open (esp. on mobile, with the keyboard up while typing in
  // it) can leave the book sized against a stale/transient viewport reading
  // that never got corrected — e.g. tapping 이동 in the price/product search
  // results closed the sheet while a resize from the keyboard closing was
  // still settling, and the book stayed shrunk into the top-left corner.
  // Resyncing against the real, current viewport every time a sheet closes
  // guarantees the book is correctly sized/centered once it's fully visible
  // again, regardless of what state things were in while it was hidden.
  syncLayout();
}

function openSheet(el) {
  closeAllFloatBars();
  allSheets.forEach((s) => s.classList.remove('open'));
  el.classList.add('open');
  activeSheet = el;
  // PC price-search is a small anchored popup, not a full bottom sheet, so
  // it only needs a light scrim to stay legible against the catalog behind
  // it rather than the heavier dimming a full-width sheet needs.
  sheetOverlay.classList.toggle('overlay-light', el.id === 'priceSearchSheet' && getLayoutMode() === 'spread');
  sheetOverlay.classList.add('open');
}

sheetOverlay.addEventListener('click', closeSheet);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && activeSheet) closeSheet();
});
document.querySelectorAll('[data-close-sheet]').forEach((btn) => {
  btn.addEventListener('click', closeSheet);
});

function toggleFloatBar(bar) {
  const willOpen = !bar.classList.contains('open');
  closeSheet();
  closeAllFloatBars();
  if (willOpen) bar.classList.add('open');
}

const zoomBar = document.getElementById('zoomBar');
document.getElementById('btnZoomToggle').addEventListener('click', () => toggleFloatBar(zoomBar));
document.getElementById('btnZoomToggleMobile').addEventListener('click', () => toggleFloatBar(zoomBar));

document.getElementById('btnShare').addEventListener('click', () => {
  openSheet(document.getElementById('shareSheet'));
  document.getElementById('shareUrlInput').value = window.location.href;
  shareViaQr();
});
function handleMoreClick() { openSheet(document.getElementById('moreSheet')); }
document.getElementById('btnMore').addEventListener('click', handleMoreClick);
document.getElementById('btnMoreMobile').addEventListener('click', handleMoreClick);

function handleThumbnailClick() {
  if (getLayoutMode() === 'spread') {
    openSheet(document.getElementById('thumbnailFilmstripPopup'));
    renderThumbnailFilmstrip();
  } else {
    openSheet(document.getElementById('thumbnailSheet'));
    renderThumbnails();
  }
}
document.getElementById('btnThumbnail').addEventListener('click', handleThumbnailClick);

function handleTocClick() {
  openSheet(document.getElementById('tocSheet'));
  renderTocPanel();
}
document.getElementById('btnToc').addEventListener('click', handleTocClick);

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
  const offsetX = state.soloOffsetX || 0;
  bookStage.style.transform = `translate(${state.panX + offsetX}px, ${state.panY}px) scale(${state.zoom})`;
  zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
}

// A solo page (cover, or the back cover if it lands alone) still renders
// inside a phantom full-spread-width stage with an empty other half, which
// visually pushes it off to one side instead of screen-center. Re-center
// it by measuring the actual gap once the DOM has settled.
function updateSoloCentering() {
  // A single rAF sometimes measures mid-flip, before PageFlip finishes
  // re-pairing pages around the newly-solo one (most noticeable jumping
  // straight to the last page) — a short delay lets it fully settle first.
  setTimeout(() => {
    // Measure with any previous solo-offset removed first — otherwise the
    // page rect we read back already includes the *last* solo page's
    // correction, and computing a new offset from that already-shifted
    // position compounds into the wrong answer.
    state.soloOffsetX = 0;
    applyStageTransform();

    const visiblePages = Array.from(bookFlipEl.querySelectorAll('.page'))
      .filter((el) => getComputedStyle(el).display !== 'none');
    if (visiblePages.length === 1) {
      const pageRect = visiblePages[0].getBoundingClientRect();
      const viewportRect = bookViewport.getBoundingClientRect();
      const pageCenterX = pageRect.left + pageRect.width / 2;
      const viewportCenterX = viewportRect.left + viewportRect.width / 2;
      state.soloOffsetX = viewportCenterX - pageCenterX;
      applyStageTransform();
    }
  }, 80);
}

// Real-time pan limits, in viewport (client) coordinates, derived from the
// CURRENT live geometry rather than any fixed formula - this stays correct
// across zoom changes, solo-page centering (soloOffsetX), and PC vs mobile
// layouts without needing to special-case any of them. "unpanned" below
// means the box position with the current pan subtracted back out, i.e.
// where the (zoomed) content would sit if pan were exactly 0 - a reference
// frame that's stable regardless of what state.panX/panY currently are,
// since CSS translate is a plain post-scale shift.
function getPanBounds() {
  const viewportRect = bookViewport.getBoundingClientRect();
  const stageRect = bookStage.getBoundingClientRect();
  const offsetX = state.soloOffsetX || 0;
  const unpannedLeft = stageRect.left - state.panX - offsetX;
  const unpannedTop = stageRect.top - state.panY;
  const { width, height } = stageRect;

  let minX, maxX;
  if (width <= viewportRect.width) {
    const centeredX = viewportRect.left + (viewportRect.width - width) / 2 - unpannedLeft - offsetX;
    minX = maxX = centeredX;
  } else {
    minX = viewportRect.right - width - unpannedLeft - offsetX;
    maxX = viewportRect.left - unpannedLeft - offsetX;
  }

  let minY, maxY;
  if (height <= viewportRect.height) {
    const centeredY = viewportRect.top + (viewportRect.height - height) / 2 - unpannedTop;
    minY = maxY = centeredY;
  } else {
    minY = viewportRect.bottom - height - unpannedTop;
    maxY = viewportRect.top - unpannedTop;
  }

  return { minX, maxX, minY, maxY };
}

function clampPanValues(panX, panY) {
  const { minX, maxX, minY, maxY } = getPanBounds();
  return {
    panX: Math.min(maxX, Math.max(minX, panX)),
    panY: Math.min(maxY, Math.max(minY, panY)),
  };
}

function setZoomedClass() {
  bookViewport.classList.toggle('zoomed', state.zoom > 1.01);
}

function setZoom(z, animate = true) {
  state.zoom = clampZoom(z);
  if (state.zoom <= 1.001) resetPan();
  bookStage.classList.toggle('panning', !animate);
  applyStageTransform();
  setZoomedClass();
}

// Zooms to `newZoom` while keeping whatever content sits under
// (anchorX, anchorY) - a screen/client point, e.g. the pinch midpoint or
// the viewport center for button-zoom - visually fixed in place, instead of
// always zooming around the stage's own CSS transform-origin (its center).
// Measures the stage's real painted rect before and after the zoom change
// rather than deriving it algebraically, since that stays correct
// regardless of the solo-page centering offset or transform-origin.
function zoomAtPoint(newZoom, anchorX, anchorY, animate = true) {
  const before = bookStage.getBoundingClientRect();
  const fx = before.width ? (anchorX - before.left) / before.width : 0.5;
  const fy = before.height ? (anchorY - before.top) / before.height : 0.5;

  state.zoom = clampZoom(newZoom);
  bookStage.classList.toggle('panning', !animate);
  applyStageTransform();

  const after = bookStage.getBoundingClientRect();
  state.panX += (anchorX - fx * after.width) - after.left;
  state.panY += (anchorY - fy * after.height) - after.top;

  if (state.zoom <= 1.001) {
    resetPan();
  } else {
    const clamped = clampPanValues(state.panX, state.panY);
    state.panX = clamped.panX;
    state.panY = clamped.panY;
  }
  applyStageTransform();
  setZoomedClass();
}

function stepZoomIn(anchorX, anchorY) {
  const steps = getZoomSteps();
  const nextStep = steps.find((s) => s > state.zoom + 0.01);
  zoomAtPoint(nextStep === undefined ? 1 : nextStep, anchorX, anchorY);
}

function stepZoomOut(anchorX, anchorY) {
  const steps = getZoomSteps();
  const prevSteps = steps.filter((s) => s < state.zoom - 0.01);
  zoomAtPoint(prevSteps.length ? prevSteps[prevSteps.length - 1] : 1, anchorX, anchorY);
}

function viewportCenter() {
  const r = bookViewport.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

document.getElementById('btnZoomIn').addEventListener('click', () => {
  const c = viewportCenter();
  stepZoomIn(c.x, c.y);
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
  const c = viewportCenter();
  stepZoomOut(c.x, c.y);
});
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

function pointMidpoint(p1, p2) {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

bookViewport.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 1) {
    singlePointerStart = {
      x: e.clientX, y: e.clientY, time: Date.now(),
      panX: state.panX, panY: state.panY, target: e.target,
    };
    if (state.zoom > 1.01) bookViewport.classList.add('panning-active');
  } else if (activePointers.size === 2) {
    isPinching = true;
    singlePointerStart = null;
    bookViewport.classList.remove('panning-active');
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
    const mid = pointMidpoint(pts[0], pts[1]);
    zoomAtPoint(gestureStartZoom * (dist / gestureStartDistance), mid.x, mid.y, false);
    e.preventDefault();
    return;
  }

  if (activePointers.size === 1 && singlePointerStart && state.zoom > 1.01) {
    const rawX = singlePointerStart.panX + (e.clientX - singlePointerStart.x);
    const rawY = singlePointerStart.panY + (e.clientY - singlePointerStart.y);
    const clamped = clampPanValues(rawX, rawY);
    state.panX = clamped.panX;
    state.panY = clamped.panY;
    bookStage.classList.add('panning');
    applyStageTransform();
    e.preventDefault();
  }
});

function endGesture(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) isPinching = false;
  bookViewport.classList.remove('panning-active');
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
      zoomAtPoint(state.zoom > 1.01 ? 1 : Math.min(2, getMaxZoom()), e.clientX, e.clientY);
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

// Client-side product search results: unlike the count/export above (which
// round-trips to the product API), this searches state.searchIndex - built
// from the currently loaded catalog's own pages - since "which page is
// this product on" is a catalog-layout concept the product API knows
// nothing about.
const productSearchResults = document.getElementById('productSearchResults');

function matchesProductQuery(entry, q) {
  const haystack = [entry.product.name, entry.product.brand, entry.product.productCode, entry.category]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function matchesBudgetFilter(entry) {
  const budget = state.budgetFilter;
  if (!budget) return true;
  const price = Number(entry.product.salePrice);
  if (budget.min !== null && price < budget.min) return false;
  if (budget.max !== null && price > budget.max) return false;
  return true;
}

function productSearchItemHtml(entry) {
  const p = entry.product;
  const img = p.croppedImageUrl || p.imageUrl;
  return `
    <div class="psr-item">
      <img class="psr-thumb" src="${img}" onerror="this.src='/assets/no-image.svg'" alt="${escapeHtml(p.name)}" />
      <div class="psr-info">
        <div class="psr-name">${escapeHtml(p.name)}</div>
        <div class="psr-price">${formatPrice(p.salePrice)}</div>
        <div class="psr-page">${entry.page}페이지</div>
      </div>
      <button type="button" class="psr-go-btn" data-goto-page="${entry.page}">이동</button>
    </div>`;
}

function renderProductSearchResults(query = '') {
  const q = query.trim().toLowerCase();
  const matches = state.searchIndex.filter((entry) => (!q || matchesProductQuery(entry, q)) && matchesBudgetFilter(entry));

  const grouped = new Map();
  const ungrouped = [];
  matches.forEach((entry) => {
    if (!entry.category) { ungrouped.push(entry); return; }
    if (!grouped.has(entry.category)) grouped.set(entry.category, []);
    grouped.get(entry.category).push(entry);
  });

  const byPage = (entries) => entries.slice().sort((a, b) => a.page - b.page).map(productSearchItemHtml).join('');
  const categoryOrder = state.catalog.categories.map((c) => c.category).filter((c) => grouped.has(c));

  let html = categoryOrder.map((category) => {
    const entries = grouped.get(category);
    return `<div class="psr-category-header">${escapeHtml(category)} (${entries.length})</div>${byPage(entries)}`;
  }).join('');
  if (ungrouped.length) html += byPage(ungrouped);

  productSearchResults.innerHTML = html || '<div class="no-results">검색 결과가 없습니다.</div>';
}

productSearchResults.addEventListener('click', (e) => {
  const el = e.target.closest('[data-goto-page]');
  if (!el) return;
  goToPage(Number(el.dataset.gotoPage));
  closeSheet();
});

function triggerExport(queryString) {
  const params = new URLSearchParams(queryString);
  const title = state.catalog && (state.catalog.seasonName || state.catalog.mainTitle);
  if (title) params.set('title', title);
  window.location.href = `/api/products/export?${params.toString()}`;
}

// The cover's baked-in "상품리스트 다운로드" button always means the full,
// unfiltered list — regardless of whatever search/budget filter happens to
// be active in the product-search sheet.
function triggerFullExport() {
  triggerExport('');
}

btnExportExcel.addEventListener('click', () => triggerExport(exportQueryString));

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
  // A real budget was entered — jump straight into the same grouped
  // results-with-이동-button list the text search already uses, filtered by
  // this price range, instead of just closing with nothing to show for it.
  if (state.budgetFilter) {
    productSearchInput.value = '';
    openSheet(document.getElementById('productSearchSheet'));
    renderProductSearchResults('');
  } else {
    closeSheet();
  }
});

function clearBudgetFilter() {
  budgetMin.value = '';
  budgetMax.value = '';
  budgetError.style.display = 'none';
  state.budgetFilter = null;
  updatePriceSearchLabel();
}

btnBudgetReset.addEventListener('click', () => {
  clearBudgetFilter();
  updateExportUI();
  closeSheet();
});

document.getElementById('btnProductSearch').addEventListener('click', () => {
  updateExportUI();
  renderProductSearchResults(productSearchInput.value);
});
productSearchInput.addEventListener('input', () => renderProductSearchResults(productSearchInput.value));
productSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') updateExportUI();
});
document.getElementById('btnProductSearchReset').addEventListener('click', () => {
  productSearchInput.value = '';
  // Also clears any budget filter that was carried over here from a price
  // search 조회 - otherwise this looked broken (results stayed filtered by
  // price even though the text query had been cleared).
  clearBudgetFilter();
  updateExportUI();
  renderProductSearchResults('');
});
function handleProductSearchToggleClick() {
  openSheet(document.getElementById('productSearchSheet'));
  renderProductSearchResults(productSearchInput.value);
}
document.getElementById('btnProductSearchToggle').addEventListener('click', handleProductSearchToggleClick);
document.getElementById('btnProductSearchToggleMobile').addEventListener('click', handleProductSearchToggleClick);

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
    cartItems.innerHTML = cart.map((item) => {
      const product = findProductById(item.productId);
      const imgSrc = (product && (product.croppedImageUrl || product.imageUrl)) || '/assets/no-image.svg';
      return `
      <div class="cart-item" data-id="${item.productId}">
        <img class="cart-item-thumb" src="${imgSrc}" alt="" onerror="this.onerror=null;this.src='/assets/no-image.svg'" />
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-price">${formatPrice(item.unitPrice)}</div>
        </div>
        <input type="number" min="1" value="${item.quantity}" data-qty="${item.productId}" />
        <button type="button" class="icon-btn cart-item-remove" data-remove="${item.productId}">삭제</button>
      </div>`;
    }).join('');
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

// Auto-hyphenate the contact phone number as the user types (e.g. 010 mobile
// numbers as 3-4-4, Seoul's 02 area code as 2-3-4/2-4-4, other area codes as
// 3-3-4/3-4-4).
function formatPhoneNumber(value) {
  const digits = value.replace(/[^0-9]/g, '').slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.startsWith('02')) {
    if (digits.length <= 5) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length <= 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}
document.getElementById('quoteCustomerContact').addEventListener('input', (e) => {
  e.target.value = formatPhoneNumber(e.target.value);
});

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
  if (pageData.type === 'orderGuide') return '주문/상담 안내';
  if (pageData.type === 'packagingInfo') return '포장 안내';
  if (pageData.type === 'toc') return '목차';
  if (pageData.type === 'back') return '주문안내';
  if (pageData.type === 'categoryGrid') return pageData.category;
  return '';
}

function pageThumbImage(pageData) {
  if (pageData.type === 'categoryGrid' && pageData.products.length) {
    const p = pageData.products[0];
    return p.croppedImageUrl || p.imageUrl;
  }
  return null;
}

function buildThumbCardsHtml(filter = '') {
  const current = state.currentPageIndex + 1;
  const q = filter.trim().toLowerCase();

  const items = state.pages
    .map((pageData, index) => ({ pageData, index, label: pageLabel(pageData) }))
    .filter(({ index, label }) => {
      if (!q) return true;
      if (String(index + 1) === q) return true;
      return label.toLowerCase().includes(q);
    });

  return items.map(({ pageData, index, label }) => {
    const img = pageThumbImage(pageData);
    return `
      <div class="thumb-card ${index + 1 === current ? 'current' : ''}" data-goto-thumb="${index + 1}">
        <div class="thumb-preview">${img ? `<img src="${img}" onerror="this.src='/assets/no-image.svg'" />` : escapeHtml(label)}</div>
        <div class="thumb-page-no">${index + 1}</div>
      </div>`;
  }).join('') || '<div class="no-results">검색 결과가 없습니다.</div>';
}

function renderThumbnails(filter = '') {
  document.getElementById('thumbnailGrid').innerHTML = buildThumbCardsHtml(filter);
}

// PC-only horizontal filmstrip popup (no search — mirrors the simpler
// reference design). Mobile/tablet keep the full search+grid bottom-sheet.
function renderThumbnailFilmstrip() {
  document.getElementById('thumbnailFilmstripRow').innerHTML = buildThumbCardsHtml();
}

function handleThumbCardClick(e) {
  const el = e.target.closest('[data-goto-thumb]');
  if (!el) return;
  goToPage(Number(el.dataset.gotoThumb));
  closeSheet();
}

document.getElementById('thumbnailGrid').addEventListener('click', handleThumbCardClick);
document.getElementById('thumbnailFilmstripRow').addEventListener('click', handleThumbCardClick);

document.getElementById('thumbnailSearch').addEventListener('input', (e) => renderThumbnails(e.target.value));

// ---------------------------------------------------------------------
// TOC panel
// ---------------------------------------------------------------------
function buildTocListHtml(filter = '') {
  const q = filter.trim().toLowerCase();
  const entries = state.tocEntries.filter((e) => !q || e.category.toLowerCase().includes(q));
  return entries.map((e) => `
    <li data-goto-toc="${e.page}"><span>${escapeHtml(e.category)}</span><span>${e.page}</span></li>
  `).join('') || '<div class="no-results">검색 결과가 없습니다.</div>';
}

function renderTocPanel(filter = '') {
  document.getElementById('tocPanelList').innerHTML = buildTocListHtml(filter);
}

function handleTocListClick(e) {
  const el = e.target.closest('[data-goto-toc]');
  if (!el) return;
  goToPage(Number(el.dataset.gotoToc));
  closeSheet();
}

document.getElementById('tocPanelList').addEventListener('click', handleTocListClick);
document.getElementById('tocSearch').addEventListener('input', (e) => renderTocPanel(e.target.value));

// ---------------------------------------------------------------------
// Mobile-only: page finder popup merging the thumbnail grid and TOC list
// behind tabs, since both exist purely to jump to a page quickly.
// ---------------------------------------------------------------------
function setPageFinderTab(tab) {
  document.querySelectorAll('.pf-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.pfTab === tab));
  const thumbPane = document.getElementById('pageFinderThumbnailPane');
  const tocPane = document.getElementById('pageFinderTocList');
  thumbPane.style.display = tab === 'thumbnail' ? '' : 'none';
  tocPane.style.display = tab === 'toc' ? '' : 'none';
  if (tab === 'thumbnail') thumbPane.innerHTML = buildThumbCardsHtml();
  else tocPane.innerHTML = buildTocListHtml();
}

document.querySelectorAll('#pageFinderPopup .pf-tab').forEach((btn) => {
  btn.addEventListener('click', () => setPageFinderTab(btn.dataset.pfTab));
});
document.getElementById('pageFinderThumbnailPane').addEventListener('click', handleThumbCardClick);
document.getElementById('pageFinderTocList').addEventListener('click', handleTocListClick);

document.getElementById('btnPageFinderMobile').addEventListener('click', () => {
  openSheet(document.getElementById('pageFinderPopup'));
  setPageFinderTab('thumbnail');
});

// Keep the book viewport clear of the toolbar/bottom clusters — both are
// zeroed out instead while auto-hidden (see the chrome auto-hide block
// near the end of this file), so the book can grow into that space.
function syncToolbarHeight() {
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) {
    const h = state.chromeHidden ? 0 : toolbar.offsetHeight;
    document.documentElement.style.setProperty('--toolbar-h', `${h}px`);
  }
  // Measured from whichever bottom bar is actually visible at this
  // breakpoint (the PC-only floating pill cluster, plus its fixed 6px
  // offset from the viewport edge, vs the mobile-only edge-to-edge bar)
  // instead of a hardcoded value, so shrinking either one's CSS size is
  // automatically reflected here without needing a matching JS change.
  const isSpread = getLayoutMode() === 'spread';
  const bottomEl = document.querySelector(isSpread ? '.bottom-cluster' : '.mobile-bottom-bar');
  const bottomH = state.chromeHidden ? 0 : (bottomEl ? bottomEl.offsetHeight + (isSpread ? 6 : 0) : 52);
  document.documentElement.style.setProperty('--bottom-h', `${bottomH}px`);
}

// Below this width, the book stays single-page (portrait); above it, a
// two-page spread. Must match minWidth in getPageFlipSettings() (2×minWidth
// =860) so PageFlip's own orientation switch and our sizing agree on the
// same breakpoint.
const SPREAD_BREAKPOINT = 860;
// See getPageFlipSettings()'s 'phone' vs 'tabletSingle' comment: only true
// phone widths get the taller ratio, since that ratio's width is capped by
// (available height × ratio) — on a portrait tablet, the available height
// isn't enough to justify a wider page at that same tall ratio, so it
// would come out narrower than the tablet screen actually allows.
const PHONE_MODE_BREAKPOINT = 480;
// Unchanged from before this file had per-mode ratios at all — kept as
// its own name for 'tabletSingle' even though it's numerically identical
// to PAGE_RATIO_SPREAD, since the two modes vary independently now.
const PAGE_RATIO_SPREAD = 660 / 860;
const PAGE_RATIO_TABLET_SINGLE = PAGE_RATIO_SPREAD;

function getLayoutMode() {
  if (window.innerWidth > SPREAD_BREAKPOINT) return 'spread';
  if (window.innerWidth <= PHONE_MODE_BREAKPOINT) return 'phone';
  return 'tabletSingle';
}

// Computes the exact pixel box PageFlip should render at: the largest
// size that (a) fits the space left after the toolbar/bottom bar and
// (b) keeps the same width:height ratio passed to `new St.PageFlip()`.
// Plain CSS (auto width/height + aspect-ratio + max-width/max-height)
// can't reliably resolve to that same answer once the container is a
// flex descendant with no definite width of its own to shrink-to-fit
// against, so this is done with real arithmetic instead.
function sizeBookFlip() {
  const mode = getLayoutMode();
  const isSingle = mode !== 'spread';
  // While the toolbar/bottom clusters are auto-hidden (still in the layout,
  // just translated off-screen), the book claims that freed space too —
  // it just doesn't need to steer clear of them anymore.
  const toolbarH = state.chromeHidden
    ? 0
    : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h')) || 50;
  const bottomH = state.chromeHidden
    ? 0
    : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-h')) || 52;
  // Minimal breathing room around the book — the top/bottom chrome is
  // already trimmed to ~50px each, so the book itself should claim
  // essentially all the space left (~85-90% of the viewport height),
  // not be pushed in further by generous margins on top of that.
  const margin = state.chromeHidden ? 4 : (isSingle ? 6 : 10);
  const maxH = Math.min(window.innerHeight - toolbarH - bottomH - margin, mode === 'phone' ? 924 : 860);
  // In spread mode the 1320 cap alone ignored how narrow the actual window
  // was just above SPREAD_BREAKPOINT (e.g. 900px wide): the requested width
  // came out wider than the viewport, got visually clamped by the parent,
  // but the page height had already been derived from the wider, unclamped
  // width — leaving a page box shorter than it should be for its own
  // rendered width, and reintroducing the very page-internal scroll this
  // sizing function exists to prevent. Capping maxW by the real window
  // width too keeps the requested and rendered widths in agreement.
  const maxW = mode === 'phone'
    ? Math.min(window.innerWidth * 0.98, 480)
    : mode === 'tabletSingle'
      ? Math.min(window.innerWidth * 0.98, 660)
      : Math.min(window.innerWidth * 0.98, 1320);
  const ratio = mode === 'phone' ? phoneRatio : mode === 'tabletSingle' ? PAGE_RATIO_TABLET_SINGLE : PAGE_RATIO_SPREAD * 2;

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
  if (getLayoutMode() === 'spread') showChrome();
  syncToolbarHeight();
  ensurePageFlipMode();
  sizeBookFlip();
  if (pageFlip) updateSoloCentering();
}
// On mobile, the on-screen keyboard opening/closing fires window resize
// events too (innerHeight shrinks/grows), even though nothing about the
// actual page layout should change. Reacting to those mid-typing made the
// catalog visibly shrink/jump/shake while the keyboard animated, and left
// it mis-sized if a tap elsewhere (e.g. a sheet's "조회"/prev-page button)
// blurred the field right as a resize tick landed. Debounce so we only
// ever act on the settled-down size, and skip entirely while a text field
// has focus - the focusout listener below re-syncs once typing is done.
let resizeSettleTimer = null;
function handleWindowResize() {
  clearTimeout(resizeSettleTimer);
  resizeSettleTimer = setTimeout(() => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    syncLayout();
  }, 150);
}
window.addEventListener('resize', handleWindowResize);
document.addEventListener('focusout', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
    clearTimeout(resizeSettleTimer);
    setTimeout(syncLayout, 250);
  }
});
syncLayout();

// ---------------------------------------------------------------------
// Auto-hide chrome: the toolbar and bottom clusters fade out after a few
// seconds of no interaction so the book can grow into that space, and
// reappear on the next tap/click. Hiding pauses (rather than cancels)
// while a sheet, float-bar, or the cart drawer is open, since those all
// count as "using a feature" and shouldn't disappear mid-use.
// ---------------------------------------------------------------------
const CHROME_IDLE_MS = 3000;
const toolbarEl = document.querySelector('.toolbar');
const chromeEls = [toolbarEl, ...document.querySelectorAll('.bottom-cluster'), document.getElementById('mobileBottomBar')];
let chromeIdleTimer = null;

function isChromeBusy() {
  return Boolean(
    activeSheet
    || allFloatBars.some((bar) => bar.classList.contains('open'))
    || document.getElementById('cartDrawer').classList.contains('open')
  );
}

function applyChromeVisibility() {
  chromeEls.forEach((el) => el.classList.toggle('chrome-hidden', state.chromeHidden));
  // #bookViewport's inset is driven by --toolbar-h/--bottom-h (zeroed out
  // by syncToolbarHeight() while hidden), so the viewport box — and the
  // book sized to fit inside it — actually grows into the space the bars
  // used to reserve, instead of just visually sliding the (still
  // reserved) bars out of the way.
  syncToolbarHeight();
  // The book only actually grows into the freed space after the CSS
  // transition finishes moving the bars out of the way; re-measuring mid
  // transition would just recompute against a still-changing layout.
  setTimeout(() => {
    sizeBookFlip();
    if (pageFlip) updateSoloCentering();
  }, 320);
}

function showChrome() {
  if (state.chromeHidden) {
    state.chromeHidden = false;
    applyChromeVisibility();
  }
}

function hideChromeIfIdle() {
  // PC (spread layout): top/bottom chrome stays fixed and never auto-hides.
  if (getLayoutMode() === 'spread') return;
  if (isChromeBusy()) {
    scheduleChromeIdle();
    return;
  }
  if (!state.chromeHidden) {
    state.chromeHidden = true;
    applyChromeVisibility();
  }
}

function scheduleChromeIdle() {
  clearTimeout(chromeIdleTimer);
  chromeIdleTimer = setTimeout(hideChromeIfIdle, CHROME_IDLE_MS);
}

function registerChromeActivity() {
  showChrome();
  scheduleChromeIdle();
}

document.addEventListener('pointerdown', registerChromeActivity, { passive: true });
registerChromeActivity();

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
    state.tocEntries = built.tocEntries;
    state.searchIndex = built.searchIndex;

    syncLayout();
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
