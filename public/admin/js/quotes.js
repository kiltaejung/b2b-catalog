const tableBody = document.getElementById('quoteTableBody');

async function fetchQuotes() {
  const res = await fetch('/api/quotes');
  const data = await res.json();
  renderQuotes(data.quotes || []);
}

function renderQuotes(quotes) {
  tableBody.innerHTML = '';
  if (!quotes.length) {
    tableBody.innerHTML = '<tr><td colspan="7" style="color:#94a3b8">생성된 견적서가 없습니다.</td></tr>';
    return;
  }
  quotes.forEach((q) => {
    const tr = document.createElement('tr');
    const createdAt = new Date(q.created_at).toLocaleString('ko-KR');
    tr.innerHTML = `
      <td>#${q.id}</td>
      <td>${q.customer_company || '-'}</td>
      <td>${q.customer_name || '-'}</td>
      <td>${q.customer_contact || '-'}</td>
      <td>${Number(q.total_amount).toLocaleString()}원</td>
      <td>${createdAt}</td>
      <td>
        <a href="/catalog/quote.html?id=${q.id}" target="_blank"><button type="button" class="secondary">상세보기</button></a>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

fetchQuotes();
