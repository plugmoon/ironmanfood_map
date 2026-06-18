(function () {
  const fields = [
    'id',
    'station_code',
    'region',
    'name',
    'city',
    'district',
    'address',
    'manager_name',
    'phone',
    'show_manager',
    'show_phone',
    'business_hours',
    'support_uber',
    'support_panda',
    'lat',
    'lng',
    'sort_order',
    'status',
    'map_url'
  ];

  const state = {
    rows: []
  };

  const el = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[char]));
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      throw new Error(data.error || '操作失敗');
    }
    return data;
  }

  function setMessage(node, message, type) {
    node.textContent = message || '';
    node.classList.toggle('error', type === 'error');
    node.classList.toggle('success', type === 'success');
  }

  function showAdmin(username) {
    el.loginView.hidden = true;
    el.adminView.hidden = false;
    el.adminSession.hidden = false;
    el.sessionName.textContent = username;
    updateMapPreview();
  }

  function showLogin() {
    el.loginView.hidden = false;
    el.adminView.hidden = true;
    el.adminSession.hidden = true;
  }

  function hasCoords(row) {
    return Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng));
  }

  function placeText(row) {
    return [row.city, row.district, row.address].filter(Boolean).join('');
  }

  function mapQuery(row) {
    if (row) {
      const namedPlace = [row.name, placeText(row)].filter(Boolean).join(' ');
      if (namedPlace) return namedPlace;
      if (hasCoords(row)) return `${row.lat},${row.lng}`;
      return '台灣';
    }

    const form = el.form?.elements;
    if (form) {
      const namedPlace = [form.name.value, [form.city.value, form.district.value, form.address.value].filter(Boolean).join('')].filter(Boolean).join(' ');
      if (namedPlace) return namedPlace;
      if (form.lat.value && form.lng.value) return `${form.lat.value},${form.lng.value}`;
    }
    return '台灣';
  }

  function googleEmbedUrl(row) {
    return `https://www.google.com/maps?q=${encodeURIComponent(mapQuery(row))}&z=16&output=embed`;
  }

  function updateMapPreview(row) {
    if (!el.adminMap) return;
    el.adminMap.src = googleEmbedUrl(row);
  }

  function deliveryLabels(row) {
    return [
      Number(row.support_uber) === 1 ? 'Uber 外送' : '',
      Number(row.support_panda) === 1 ? '熊貓外送' : ''
    ].filter(Boolean);
  }

  function visibilityLabels(row) {
    return [
      Number(row.show_manager ?? 1) === 1 ? '' : '負責人前台隱藏',
      Number(row.show_phone ?? 1) === 1 ? '' : '電話前台隱藏'
    ].filter(Boolean);
  }

  async function checkSession() {
    try {
      const me = await api('/api/admin/me');
      showAdmin(me.username);
      await loadRows();
    } catch {
      showLogin();
    }
  }

  async function login(event) {
    event.preventDefault();
    const formData = new FormData(el.loginForm);
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: formData.get('username'),
          password: formData.get('password')
        })
      });
      setMessage(el.loginMessage, '', '');
      showAdmin(result.username);
      await loadRows();
    } catch (error) {
      setMessage(el.loginMessage, error.message, 'error');
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    showLogin();
  }

  function rowMatches(row) {
    const keyword = el.adminKeyword.value.trim().toLowerCase();
    const status = el.adminStatus.value;
    const text = [
      row.station_code,
      row.region,
      row.name,
      row.city,
      row.district,
      row.address,
      row.manager_name,
      row.phone,
      row.business_hours,
      ...deliveryLabels(row)
    ].join(' ').toLowerCase();
    return (!keyword || text.includes(keyword)) && (!status || String(row.status) === status);
  }

  function renderRows() {
    const rows = state.rows.filter(rowMatches);
    if (!rows.length) {
      el.locationRows.innerHTML = '<tr><td colspan="5">沒有資料</td></tr>';
      return;
    }

    el.locationRows.innerHTML = rows.map((row) => `
      <tr>
        <td>
          <div class="row-title">${escapeHtml(row.name)}</div>
          <div class="row-sub">${escapeHtml([row.station_code || '未設定代碼', deliveryLabels(row).join(' / '), visibilityLabels(row).join(' / ')].filter(Boolean).join(' · '))}</div>
        </td>
        <td>
          ${escapeHtml([row.region || row.city, row.district].filter(Boolean).join(' / ') || '未設定')}
          <div class="row-sub">${escapeHtml(row.address || '')}</div>
        </td>
        <td>${escapeHtml(row.phone || '')}</td>
        <td>${Number(row.status) === 1 ? '顯示' : '隱藏'}</td>
        <td>
          <div class="table-actions">
            <button class="text-button" type="button" data-action="edit" data-id="${row.id}">編輯</button>
            <button class="text-button danger" type="button" data-action="delete" data-id="${row.id}">刪除</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function loadRows() {
    state.rows = await api('/api/admin/locations');
    renderRows();
  }

  function readForm() {
    const data = {};
    fields.forEach((field) => {
      const control = el.form.elements[field];
      if (!control) return;
      data[field] = control.type === 'checkbox' ? (control.checked ? 1 : 0) : control.value;
    });
    data.status = Number(data.status);
    data.sort_order = Number(data.sort_order || 0);
    data.lat = data.lat === '' ? null : Number(data.lat);
    data.lng = data.lng === '' ? null : Number(data.lng);
    return data;
  }

  function fillForm(row) {
    fields.forEach((field) => {
      const control = el.form.elements[field];
      if (!control) return;
      if (control.type === 'checkbox') {
        control.checked = Number(row[field]) === 1;
      } else {
        control.value = row[field] ?? '';
      }
    });
    el.formTitle.textContent = row.id ? '編輯據點' : '新增據點';
    setMessage(el.formMessage, '', '');
    updateMapPreview(row);
  }

  function resetForm() {
    el.form.reset();
    el.form.elements.id.value = '';
    el.form.elements.status.value = '1';
    el.form.elements.sort_order.value = '0';
    el.form.elements.show_manager.checked = true;
    el.form.elements.show_phone.checked = true;
    el.form.elements.support_uber.checked = false;
    el.form.elements.support_panda.checked = false;
    el.formTitle.textContent = '新增據點';
    setMessage(el.formMessage, '', '');
    updateMapPreview();
  }

  async function saveLocation(event) {
    if (event) event.preventDefault();
    const data = readForm();
    const id = Number(data.id);
    try {
      if (id) {
        await api(`/api/admin/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        await loadRows();
        resetForm();
        setMessage(el.formMessage, '已更新', 'success');
      } else {
        await api('/api/admin/locations', { method: 'POST', body: JSON.stringify(data) });
        await loadRows();
        resetForm();
        setMessage(el.formMessage, '已新增', 'success');
      }
    } catch (error) {
      setMessage(el.formMessage, error.message, 'error');
    }
  }

  async function handleTableClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = Number(button.dataset.id);
    const row = state.rows.find((item) => Number(item.id) === id);
    if (!row) return;

    if (button.dataset.action === 'edit') {
      fillForm(row);
      el.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (button.dataset.action === 'delete' && window.confirm(`刪除「${row.name}」？`)) {
      await api(`/api/admin/locations/${id}`, { method: 'DELETE' });
      await loadRows();
      resetForm();
    }
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (char !== '\r') {
        cell += char;
      }
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter((items) => items.some((item) => item.trim()));
  }

  function normalizeHeader(header) {
    const key = header.trim();
    const aliases = {
      google_map_url: 'map_url',
      '地圖連結': 'map_url',
      'Google地圖連結': 'map_url',
      'Google 地圖連結': 'map_url',
      '導航連結': 'map_url',
      '站別': 'station_code',
      '站別代碼': 'station_code',
      '區域': 'region',
      '商家名稱': 'name',
      '名稱': 'name',
      '縣市': 'city',
      '城市': 'city',
      '行政區': 'district',
      '地址': 'address',
      '負責人': 'manager_name',
      '區域經理': 'manager_name',
      '電話': 'phone',
      '聯絡電話': 'phone',
      show_manager: 'show_manager',
      '顯示負責人': 'show_manager',
      '前台顯示負責人': 'show_manager',
      '負責人顯示': 'show_manager',
      show_phone: 'show_phone',
      '顯示電話': 'show_phone',
      '前台顯示電話': 'show_phone',
      '電話顯示': 'show_phone',
      '營業時間': 'business_hours',
      support_uber: 'support_uber',
      uber_delivery: 'support_uber',
      uber: 'support_uber',
      '支援Uber': 'support_uber',
      '支援 Uber': 'support_uber',
      '是否支援Uber': 'support_uber',
      '是否支援 Uber': 'support_uber',
      'Uber外送': 'support_uber',
      'Uber 外送': 'support_uber',
      support_panda: 'support_panda',
      panda_delivery: 'support_panda',
      foodpanda: 'support_panda',
      '支援熊貓': 'support_panda',
      '支援 熊貓': 'support_panda',
      '是否支援熊貓': 'support_panda',
      '是否支援 熊貓': 'support_panda',
      '熊貓外送': 'support_panda',
      '熊貓 外送': 'support_panda',
      'Foodpanda外送': 'support_panda',
      'Foodpanda 外送': 'support_panda',
      '緯度': 'lat',
      '經度': 'lng',
      '狀態': 'status',
      '排序': 'sort_order'
    };
    return aliases[key] || key;
  }

  function csvToLocations(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map(normalizeHeader);
    return rows.slice(1).map((values) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = values[index] ?? '';
      });
      return item;
    });
  }

  async function importCsv(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const locations = csvToLocations(text);
      const result = await api('/api/admin/import', {
        method: 'POST',
        body: JSON.stringify({
          mode: el.importMode.value,
          locations
        })
      });
      setMessage(el.importMessage, `已匯入 ${result.imported} 筆，略過 ${result.skipped} 筆`, result.skipped ? 'error' : 'success');
      await loadRows();
      resetForm();
    } catch (error) {
      setMessage(el.importMessage, error.message, 'error');
    } finally {
      event.target.value = '';
    }
  }

  function bind() {
    el.loginForm.addEventListener('submit', login);
    el.logoutButton.addEventListener('click', logout);
    el.form.addEventListener('submit', saveLocation);
    el.saveButton.addEventListener('click', saveLocation);
    el.resetButton.addEventListener('click', resetForm);
    el.locationRows.addEventListener('click', handleTableClick);
    el.adminKeyword.addEventListener('input', renderRows);
    el.adminStatus.addEventListener('change', renderRows);
    el.csvInput.addEventListener('change', importCsv);
    ['name', 'city', 'district', 'address', 'lat', 'lng'].forEach((name) => {
      el.form.elements[name].addEventListener('change', () => updateMapPreview());
    });
  }

  function bindGlobalErrors() {
    window.addEventListener('error', (event) => {
      const message = event.message || '後台發生未預期錯誤';
      const target = el.formMessage || el.loginMessage || el.importMessage;
      if (target) setMessage(target, message, 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      const message = event.reason?.message || '後台操作失敗';
      const target = el.formMessage || el.loginMessage || el.importMessage;
      if (target) setMessage(target, message, 'error');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    [
      'loginView',
      'adminView',
      'adminSession',
      'sessionName',
      'loginForm',
      'loginMessage',
      'logoutButton',
      'locationForm',
      'saveButton',
      'formTitle',
      'formMessage',
      'resetButton',
      'locationRows',
      'adminKeyword',
      'adminStatus',
      'csvInput',
      'importMode',
      'importMessage',
      'adminMap'
    ].forEach((id) => {
      el[id] = byId(id);
    });
    el.form = el.locationForm;
    bindGlobalErrors();
    bind();
    updateMapPreview();
    checkSession();
  });
}());
