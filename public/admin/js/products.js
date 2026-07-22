const FIELD_IDS = [
  'display_order', 'category', 'product_code', 'name', 'brand', 'image_url',
  'original_price', 'sale_price', 'composition', 'packaging', 'origin', 'tax_type',
  'features', 'description', 'shipping_info', 'promo_badge',
];

const tableBody = document.getElementById('productTableBody');
const searchInput = document.getElementById('searchInput');
const modalBackdrop = document.getElementById('productModalBackdrop');
const productForm = document.getElementById('productForm');
const formErrors = document.getElementById('formErrors');
const modalTitle = document.getElementById('modalTitle');

const imageAdjustSection = document.getElementById('imageAdjustSection');
const imageAdjustHint = document.getElementById('imageAdjustHint');
const imageAdjustPreviewImg = document.getElementById('imageAdjustPreviewImg');
const imageAdjustStatus = document.getElementById('imageAdjustStatus');
const imgAdjustZoom = document.getElementById('imgAdjustZoom');
const imgAdjustOffsetX = document.getElementById('imgAdjustOffsetX');
const imgAdjustOffsetY = document.getElementById('imgAdjustOffsetY');

let searchTimer = null;

function updateImageAdjustPreviewTransform() {
  const zoom = Number(imgAdjustZoom.value);
  const offsetX = Number(imgAdjustOffsetX.value);
  const offsetY = Number(imgAdjustOffsetY.value);
  imageAdjustPreviewImg.style.transform = `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`;
}

function setImageAdjustFromProduct(product) {
  if (!product || !product.id) {
    imageAdjustSection.style.display = 'none';
    imageAdjustHint.style.display = '';
    return;
  }
  imageAdjustSection.style.display = '';
  imageAdjustHint.style.display = 'none';
  imageAdjustStatus.textContent = '';
  imageAdjustPreviewImg.src = product.cropped_image_url || product.image_url;
  imgAdjustZoom.value = product.image_zoom ?? 1;
  imgAdjustOffsetX.value = product.image_offset_x ?? 0;
  imgAdjustOffsetY.value = product.image_offset_y ?? 0;
  updateImageAdjustPreviewTransform();
}

async function saveImageAdjust() {
  const id = document.getElementById('productId').value;
  if (!id) return;
  imageAdjustStatus.textContent = '저장 중...';
  try {
    const res = await fetch(`/api/products/${id}/image-adjust`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zoom: Number(imgAdjustZoom.value),
        offsetX: Number(imgAdjustOffsetX.value),
        offsetY: Number(imgAdjustOffsetY.value),
      }),
    });
    imageAdjustStatus.textContent = res.ok ? '저장됨' : '저장 실패';
  } catch {
    imageAdjustStatus.textContent = '저장 실패';
  }
  setTimeout(() => { imageAdjustStatus.textContent = ''; }, 1500);
}

[imgAdjustZoom, imgAdjustOffsetX, imgAdjustOffsetY].forEach((el) => {
  el.addEventListener('input', updateImageAdjustPreviewTransform);
  el.addEventListener('change', saveImageAdjust);
});

document.getElementById('btnResetImageAdjust').addEventListener('click', () => {
  imgAdjustZoom.value = 1;
  imgAdjustOffsetX.value = 0;
  imgAdjustOffsetY.value = 0;
  updateImageAdjustPreviewTransform();
  saveImageAdjust();
});

async function fetchProducts(search = '') {
  const res = await fetch(`/api/products${search ? `?search=${encodeURIComponent(search)}` : ''}`);
  const data = await res.json();
  renderProducts(data.products || []);
}

function renderProducts(products) {
  tableBody.innerHTML = '';
  products.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img class="thumb" src="${p.image_url}" onerror="this.src='../assets/no-image.svg'" /></td>
      <td>${p.display_order}</td>
      <td>${p.category}</td>
      <td>${p.product_code}</td>
      <td>${p.name}</td>
      <td>${p.brand || ''}</td>
      <td>${Number(p.sale_price).toLocaleString()}원</td>
      <td>${p.promo_badge ? `<span class="badge">${p.promo_badge}</span>` : ''}</td>
      <td>
        <button type="button" class="secondary" data-edit="${p.id}">수정</button>
        <button type="button" class="danger" data-delete="${p.id}">삭제</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function openModal(product = null) {
  productForm.reset();
  formErrors.style.display = 'none';
  document.getElementById('productId').value = product ? product.id : '';
  modalTitle.textContent = product ? '상품 수정' : '상품 추가';
  if (product) {
    FIELD_IDS.forEach((field) => {
      const el = document.getElementById(field);
      if (el) el.value = product[field] ?? '';
    });
  }
  setImageAdjustFromProduct(product);
  modalBackdrop.classList.add('open');
}

function closeModal() {
  modalBackdrop.classList.remove('open');
}

function collectFormData() {
  const data = {};
  FIELD_IDS.forEach((field) => {
    const el = document.getElementById(field);
    data[field] = el.value;
  });
  return data;
}

function showErrors(errors) {
  formErrors.style.display = 'block';
  formErrors.innerHTML = `<ul>${errors.map((e) => `<li>[${e.field || ''}] ${e.message}</li>`).join('')}</ul>`;
}

productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('productId').value;
  const payload = collectFormData();
  const url = id ? `/api/products/${id}` : '/api/products';
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    showErrors(data.errors || [{ message: data.error || '저장에 실패했습니다.' }]);
    return;
  }

  closeModal();
  fetchProducts(searchInput.value);
});

document.getElementById('newProductBtn').addEventListener('click', () => openModal());
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

tableBody.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;

  if (editId) {
    const res = await fetch(`/api/products/${editId}`);
    const data = await res.json();
    openModal(data.product);
  }

  if (deleteId) {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;
    await fetch(`/api/products/${deleteId}`, { method: 'DELETE' });
    fetchProducts(searchInput.value);
  }
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchProducts(searchInput.value), 300);
});

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  window.location.href = '/api/products/template';
});

document.getElementById('uploadBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('excelFile');
  const resultBox = document.getElementById('uploadResult');
  if (!fileInput.files.length) {
    resultBox.innerHTML = '<div class="errors">업로드할 엑셀 파일을 선택해주세요.</div>';
    return;
  }

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  const res = await fetch('/api/products/upload', { method: 'POST', body: formData });
  const data = await res.json();

  if (!res.ok) {
    const errors = data.errors || [{ message: data.error }];
    resultBox.innerHTML = `<div class="errors"><strong>업로드 오류 (${errors.length}건)</strong><ul>${errors
      .map((err) => `<li>${err.row ? `${err.row}행 ` : ''}[${err.field || ''}] ${err.message}</li>`)
      .join('')}</ul></div>`;
    return;
  }

  resultBox.innerHTML = `<div class="badge">신규 ${data.inserted}건 / 수정 ${data.updated}건 처리 완료</div>`;
  fileInput.value = '';
  fetchProducts(searchInput.value);
});

fetchProducts();
