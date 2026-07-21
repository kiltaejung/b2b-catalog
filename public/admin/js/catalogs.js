const tableBody = document.getElementById('catalogTableBody');
const catalogForm = document.getElementById('catalogForm');
const errorsBox = document.getElementById('catalogFormErrors');

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
        <button type="button" class="danger" data-delete="${c.id}">삭제</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

tableBody.addEventListener('click', async (e) => {
  const deleteId = e.target.dataset.delete;
  if (!deleteId) return;
  if (!confirm('이 카탈로그를 삭제하시겠습니까?')) return;
  await fetch(`/api/catalogs/${deleteId}`, { method: 'DELETE' });
  fetchCatalogs();
});

catalogForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorsBox.style.display = 'none';

  const categoryOrderRaw = document.getElementById('categoryOrder').value.trim();
  const payload = {
    seasonName: document.getElementById('seasonName').value || null,
    mainTitle: document.getElementById('mainTitle').value,
    companyLogoUrl: document.getElementById('companyLogoUrl').value || null,
    coverImageUrl: document.getElementById('coverImageUrl').value || null,
    clientName: document.getElementById('clientName').value || null,
    clientLogoUrl: document.getElementById('clientLogoUrl').value || null,
    showPrice: document.getElementById('showPrice').checked,
    categoryOrder: categoryOrderRaw ? categoryOrderRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };

  const res = await fetch('/api/catalogs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    errorsBox.style.display = 'block';
    errorsBox.textContent = data.error || '카탈로그 생성에 실패했습니다.';
    return;
  }

  catalogForm.reset();
  document.getElementById('showPrice').checked = true;
  fetchCatalogs();
});

fetchCatalogs();
