(function () {
  const TaiwanCenter = [23.6978, 120.9605];
  const elements = {};
  const state = {
    locations: [],
    filtered: [],
    selectedId: null,
    map: null,
    markers: null,
    userLayer: null,
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

  function navUrl(item) {
    if (item.map_url) return item.map_url;
    if (hasCoords(item)) {
      return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(item.lat)}&mlon=${encodeURIComponent(item.lng)}#map=17/${encodeURIComponent(item.lat)}/${encodeURIComponent(item.lng)}`;
    }
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(placeText(item) || item.name)}`;
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
          <a class="link-button" href="${escapeHtml(navUrl(item))}" target="${linkTarget()}" rel="noopener">開啟地圖</a>
        </div>
      </article>
    `;
  }

  function popupHtml(item) {
    return `
      <span class="popup-title">${escapeHtml(item.name)}</span>
      ${escapeHtml(placeText(item) || '')}<br>
      ${Number(item.show_phone ?? 1) === 1 && item.phone ? escapeHtml(item.phone) : ''}
      ${item.business_hours ? `<br>營業時間 ${escapeHtml(item.business_hours)}` : ''}
      ${deliveryLabels(item).length ? `<br>${escapeHtml(deliveryLabels(item).join(' / '))}` : ''}
    `;
  }

  function renderList() {
    elements.resultSummary.textContent = `${state.filtered.length} 個據點`;
    if (!state.filtered.length) {
      elements.storeList.innerHTML = '<div class="empty-state">沒有符合條件的據點</div>';
      return;
    }
    elements.storeList.innerHTML = state.filtered.map(cardHtml).join('');
  }

  function renderMap() {
    state.markers.clearLayers();
    const bounds = [];

    state.filtered.forEach((item) => {
      if (!hasCoords(item)) return;
      const latLng = [Number(item.lat), Number(item.lng)];
      bounds.push(latLng);
      const marker = L.marker(latLng).addTo(state.markers);
      marker.bindPopup(popupHtml(item));
      marker.on('click', () => selectStore(item.id, false));
      marker.locationId = item.id;
    });

    if (bounds.length) {
      state.map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
    } else {
      state.map.setView(TaiwanCenter, 7);
    }
  }

  function render() {
    renderList();
    renderMap();
  }

  function selectStore(id, moveMap) {
    state.selectedId = id;
    const item = state.filtered.find((row) => row.id === id);
    renderList();
    if (!item || !hasCoords(item) || moveMap === false) return;
    state.map.setView([Number(item.lat), Number(item.lng)], 16);
    state.markers.eachLayer((marker) => {
      if (marker.locationId === id) marker.openPopup();
    });
    if (window.innerWidth < 960) {
      byId('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setupMap() {
    state.map = L.map('map', { zoomControl: true }).setView(TaiwanCenter, 7);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(state.map);
    state.markers = L.layerGroup().addTo(state.map);
    state.userLayer = L.layerGroup().addTo(state.map);
  }

  async function loadLocations() {
    try {
      const response = await fetch('/api/locations', { cache: 'no-store' });
      if (!response.ok) throw new Error('讀取失敗');
      state.locations = await response.json();
      refreshFilters();
      filterLocations();
      setStatus('已更新');
      setTimeout(() => state.map.invalidateSize(), 120);
    } catch (error) {
      setStatus('讀取失敗');
      elements.storeList.innerHTML = '<div class="empty-state">目前無法讀取據點資料</div>';
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
      state.userLayer.clearLayers();
      L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
        radius: 8,
        weight: 3,
        color: '#b76e00',
        fillColor: '#f59e0b',
        fillOpacity: 0.8
      }).addTo(state.userLayer).bindPopup('目前位置');
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
      refreshFilters();
      filterLocations();
    });
    elements.districtSelect.addEventListener('change', filterLocations);
    elements.storeList.addEventListener('click', (event) => {
      if (event.target.closest('a')) return;
      const card = event.target.closest('.store-card');
      if (card) selectStore(Number(card.dataset.id), true);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    ['keywordInput', 'regionSelect', 'districtSelect', 'searchButton', 'nearbyButton', 'loadStatus', 'resultSummary', 'storeList'].forEach((id) => {
      elements[id] = byId(id);
    });
    setupMap();
    bindEvents();
    loadLocations();
  });
}());
