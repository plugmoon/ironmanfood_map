(function () {
  const elements = {};
  const state = {
    locations: [],
    filtered: [],
    selectedId: null,
    userLocation: null
  };

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

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  function hasCoords(item) {
    return Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng));
  }

  function placeText(item) {
    return [item.city, item.district, item.address].filter(Boolean).join('');
  }

  function locationQuery(item) {
    if (!item) return '台灣';
    const place = placeText(item);
    const namedPlace = [item.name, place].filter(Boolean).join(' ');
    if (namedPlace) return namedPlace;
    if (hasCoords(item)) return `${item.lat},${item.lng}`;
    return '台灣';
  }

  function base64UrlUtf8(value) {
    const bytes = new TextEncoder().encode(value || '台灣');
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function googleEmbedUrlFromQuery(query, zoom) {
    const encodedQuery = base64UrlUtf8(query);
    return `https://www.google.com/maps/embed?origin=mfe&pb=!1m3!2m1!1z${encodedQuery}!6i${zoom}!3m1!1szh-TW!5m1!1szh-TW`;
  }

  function googleSearchEmbedUrl(item, zoom = 16) {
    return googleEmbedUrlFromQuery(locationQuery(item), zoom);
  }

  function googleAllLocationsEmbedUrl(items) {
    const rows = items.filter((item) => locationQuery(item) !== '台灣');
    if (!rows.length) return googleSearchEmbedUrl(null, 7);
    if (rows.length === 1) return googleSearchEmbedUrl(rows[0], 16);

    const query = rows.slice(0, 10).map(locationQuery).join(' | ');
    return googleEmbedUrlFromQuery(query, 12);
  }

  function navUrl(item) {
    if (!item) return 'https://www.google.com/maps';
    if (!item.name && !placeText(item) && item.map_url) return item.map_url;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationQuery(item))}`;
  }

  function linkTarget() {
    return /Line/i.test(navigator.userAgent) ? '_self' : '_blank';
  }

  function distanceKm(from, to) {
    if (!from || !hasCoords(to)) return null;
    const radius = 6371;
    const dLat = (Number(to.lat) - from.lat) * Math.PI / 180;
    const dLng = (Number(to.lng) - from.lng) * Math.PI / 180;
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = Number(to.lat) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(item) {
    const distance = distanceKm(state.userLocation, item);
    if (distance === null) return '';
    return distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`;
  }

  function deliveryLabels(item) {
    return [
      Number(item.support_uber) === 1 ? '可 Uber 外送' : '',
      Number(item.support_panda) === 1 ? '可熊貓外送' : ''
    ].filter(Boolean);
  }

  function setStatus(text) {
    elements.loadStatus.textContent = text;
  }

  function fillSelect(select, values, placeholder, currentValue) {
    select.innerHTML = `<option value="">${placeholder}</option>${values.map((value) => {
      const selected = value === currentValue ? ' selected' : '';
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
    }).join('')}`;
  }

  function refreshFilters() {
    const currentRegion = elements.regionSelect.value;
    const currentDistrict = elements.districtSelect.value;
    fillSelect(elements.regionSelect, unique(state.locations.map((item) => item.region || item.city)), '全部區域', currentRegion);
    const districtRows = elements.regionSelect.value
      ? state.locations.filter((item) => (item.region || item.city) === elements.regionSelect.value)
      : state.locations;
    fillSelect(elements.districtSelect, unique(districtRows.map((item) => item.district)), '全部行政區', currentDistrict);
  }

  function filterLocations() {
    const keyword = elements.keywordInput.value.trim().toLowerCase();
    const region = elements.regionSelect.value;
    const district = elements.districtSelect.value;
    state.filtered = state.locations.filter((item) => {
      const text = [
        item.station_code,
        item.region,
        item.name,
        item.city,
        item.district,
        item.address,
        item.manager_name,
        item.phone,
        item.business_hours,
        ...deliveryLabels(item)
      ].join(' ').toLowerCase();
      return (!keyword || text.includes(keyword))
        && (!region || (item.region || item.city) === region)
        && (!district || item.district === district);
    });

    if (state.userLocation) {
      state.filtered.sort((a, b) => {
        const left = distanceKm(state.userLocation, a);
        const right = distanceKm(state.userLocation, b);
        if (left === null && right === null) return (a.sort_order - b.sort_order) || (b.id - a.id);
        if (left === null) return 1;
        if (right === null) return -1;
        return left - right;
      });
    }

    if (!state.filtered.some((item) => item.id === state.selectedId)) {
      state.selectedId = null;
    }
    render();
  }

  function cardHtml(item) {
    const active = state.selectedId === item.id ? ' active' : '';
    const chips = [item.region || item.city, item.district, formatDistance(item)].filter(Boolean);
    const delivery = deliveryLabels(item);
    const phone = Number(item.show_phone ?? 1) === 1 && item.phone ? `<a class="phone-link" href="tel:${escapeHtml(item.phone)}">${escapeHtml(item.phone)}</a>` : '';
    const manager = Number(item.show_manager ?? 1) === 1 && item.manager_name ? `負責人 ${escapeHtml(item.manager_name)}` : '';
    const hours = item.business_hours ? `營業時間 ${escapeHtml(item.business_hours)}` : '';
    return `
      <article class="store-card${active}" data-id="${item.id}">
        <h2>${escapeHtml(item.name)}</h2>
        <div class="store-meta">
          ${chips.map((chip) => `<span class="meta-chip">${escapeHtml(chip)}</span>`).join('')}
          ${delivery.map((chip) => `<span class="meta-chip delivery-chip">${escapeHtml(chip)}</span>`).join('')}
        </div>
        <div class="store-detail">${escapeHtml(placeText(item) || '地址未設定')}</div>
        <div class="store-detail">${[manager, phone, hours].filter(Boolean).join(' / ')}</div>
        <div class="store-actions">
          <a class="link-button" href="${escapeHtml(navUrl(item))}" target="${linkTarget()}" rel="noopener">開啟 Google 地圖</a>
        </div>
      </article>
    `;
  }

  function renderList() {
    const allButton = state.selectedId
      ? '<button class="text-button" type="button" id="showAllMapButton">顯示全部據點</button>'
      : '';
    elements.resultSummary.innerHTML = `<span>${state.filtered.length} 個據點</span>${allButton}`;
    if (!state.filtered.length) {
      elements.storeList.innerHTML = '<div class="empty-state">沒有符合條件的據點</div>';
      return;
    }
    elements.storeList.innerHTML = state.filtered.map(cardHtml).join('');
  }

  function renderMap() {
    const selected = state.filtered.find((item) => item.id === state.selectedId) || null;
    elements.mapFrame.src = selected ? googleSearchEmbedUrl(selected) : googleAllLocationsEmbedUrl(state.filtered);
    elements.mapFrame.title = selected ? `${selected.name} Google 地圖` : '全部據點 Google 地圖';
  }

  function render() {
    renderList();
    renderMap();
  }

  function selectStore(id, moveMap) {
    state.selectedId = id;
    render();
    if (moveMap && window.innerWidth < 960) {
      byId('mapFrame').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function loadLocations() {
    try {
      const response = await fetch('/api/locations', { cache: 'no-store' });
      if (!response.ok) throw new Error('讀取失敗');
      state.locations = await response.json();
      state.selectedId = null;
      refreshFilters();
      filterLocations();
      setStatus('已更新');
    } catch (error) {
      setStatus('讀取失敗');
      elements.storeList.innerHTML = '<div class="empty-state">目前無法讀取據點資料</div>';
      renderMap();
    }
  }

  function locateNearby() {
    if (!navigator.geolocation) {
      setStatus('不支援定位');
      return;
    }
    setStatus('定位中');
    navigator.geolocation.getCurrentPosition((position) => {
      state.userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      filterLocations();
      setStatus('附近優先');
    }, () => setStatus('定位失敗'), {
      enableHighAccuracy: true,
      timeout: 8000
    });
  }

  function bindEvents() {
    elements.searchButton.addEventListener('click', filterLocations);
    elements.nearbyButton.addEventListener('click', locateNearby);
    elements.keywordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') filterLocations();
    });
    elements.keywordInput.addEventListener('input', () => {
      if (!elements.keywordInput.value) filterLocations();
    });
    elements.regionSelect.addEventListener('change', () => {
      state.selectedId = null;
      refreshFilters();
      filterLocations();
    });
    elements.districtSelect.addEventListener('change', () => {
      state.selectedId = null;
      filterLocations();
    });
    elements.resultSummary.addEventListener('click', (event) => {
      if (event.target.closest('#showAllMapButton')) {
        state.selectedId = null;
        render();
      }
    });
    elements.storeList.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const card = event.target.closest('.store-card');
      if (card) selectStore(Number(card.dataset.id), true);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['keywordInput', 'regionSelect', 'districtSelect', 'searchButton', 'nearbyButton', 'loadStatus', 'resultSummary', 'storeList', 'mapFrame'].forEach((id) => {
      elements[id] = byId(id);
    });
    bindEvents();
    loadLocations();
  });
}());
