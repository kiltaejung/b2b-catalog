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
      <td>${c.main_title}</td>
      <td>${c.season_name || ''}</td>
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

fetchCatalogs();
