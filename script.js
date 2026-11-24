(function () {
  'use strict';

  const OVERVIEW = { center: [58.52, 31.28], zoom: 12 };
  const FOCUS_ZOOM = 16;
  const CADASTRE_ZOOM = 15;
  const TYPE_LABELS = { single: 'Монастырь', complex: 'Комплекс' };

  const CADASTRE_STYLE = {
    color: '#0f766e', fillColor: '#14b8a6', weight: 2, opacity: 0.95, fillOpacity: 0.35
  };
  const CADASTRE_SURROUNDINGS = {
    color: '#64748b', fillColor: '#94a3b8', weight: 1.6, opacity: 0.9, fillOpacity: 0.28
  };
  const CADASTRE_ACTIVE = {
    color: '#7d4a06', fillColor: '#d68910', weight: 3, opacity: 1, fillOpacity: 0.6
  };

  const PZZ_STYLES = {
    'Жилая зона': { label: 'Жилая застройка', color: '#a16207', fillColor: '#f7cf72' },
    'Общественно-деловая зона': { label: 'Общественно-деловая', color: '#1d4ed8', fillColor: '#9db8e8' },
    'Производственная зона, зона инженерной и транспортной инфраструктур': {
      label: 'Производственная и инфраструктура', color: '#6b21a8', fillColor: '#cbb0df'
    },
    'Зона рекреационного назначения': { label: 'Рекреационная', color: '#166534', fillColor: '#a9d8b4' },
    'Зона специального назначения': { label: 'Специального назначения', color: '#9d174d', fillColor: '#e5b3ce' },
    'Иная зона': { label: 'Иная зона (в т. ч. ж/д)', color: '#57534e', fillColor: '#d6d3d1' }
  };
  const PZZ_HISTORIC = { label: 'Специальная историческая зона', color: '#854d0e', fillColor: '#e9c85c' };
  const PZZ_CEMETERY = { label: 'Зона кладбищ', color: '#78350f', fillColor: '#d6b5a2' };

  const COLORS = {
    base: '#c0392b',
    hover: '#e74c3c',
    active: '#d68910',
    activeBorder: '#7d4a06'
  };

  const panel = document.getElementById('panel');
  const plotPanel = document.getElementById('plot-panel');
  const lightbox = document.getElementById('lightbox');
  const markers = new Map();
  const monasteryFeatures = new Map();
  const cadastrePlots = new Map();
  const plotLayers = new Map();

  let map = null;
  let activeId = null;
  let selectionToken = 0;
  let ignoreMapClick = false;
  let pzzLayer = null;
  let pzzVisible = true;
  let cadastreLayer = null;
  let markersVisible = true;
  let selectedPlotLayer = null;
  let lightboxPaths = [];
  let lightboxIndex = 0;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function capitalize(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
  }

  function displayValue(value) {
    return value == null || value === '' || value === '-' ? '—' : escapeHtml(value);
  }

  function factRow(label, value) {
    return `<div><dt>${label}</dt><dd>${displayValue(value)}</dd></div>`;
  }

  function formatArea(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString('ru-RU') + ' м²';
  }

  function cadastreStyle(feature) {
    const base = feature.properties.surroundings ? CADASTRE_SURROUNDINGS : CADASTRE_STYLE;
    return {
      color: base.color,
      fillColor: base.fillColor,
      weight: base.weight,
      opacity: base.opacity,
      fillOpacity: base.fillOpacity,
      dashArray: feature.properties.surroundings ? '4 3' : undefined
    };
  }

  function pzzStyle(feature) {
    const props = feature.properties;
    const name = String(props.name_by_doc || '');
    let style;

    if (/Специальная историческая зона/i.test(name)) {
      style = PZZ_HISTORIC;
    } else if (/кладбищ/i.test(name)) {
      style = PZZ_CEMETERY;
    } else {
      style = PZZ_STYLES[props.type_zone] || { color: '#6b7280', fillColor: '#cbd5e1' };
    }

    return {
      color: style.color,
      fillColor: style.fillColor,
      weight: 1.4,
      opacity: 0.85,
      fillOpacity: 0.2
    };
  }

  function renderPzzLegend() {
    const items = [PZZ_HISTORIC, PZZ_CEMETERY].concat(
      Object.keys(PZZ_STYLES).map(function (key) { return PZZ_STYLES[key]; })
    );

    return items.map(function (item) {
      return `<div class="pzz-legend__item">` +
        `<span class="pzz-legend__swatch" style="background:${item.fillColor};border-color:${item.color}"></span>` +
        `${escapeHtml(item.label)}</div>`;
    }).join('');
  }

  function renderIntro() {
    panel.innerHTML = `
      <section class="intro">
        <div class="intro__label">Монастыри Великого Новгорода</div>
        <h1>Novg Monastyri</h1>
        <p class="intro__hint">Кликните на точку, зону или участок</p>
        <div class="intro__count">25 точек на карте</div>
        <div class="intro__legend"><span class="intro__legend-line"></span>Граница Великого Новгорода</div>
        <div class="intro__legend"><span class="intro__legend-area"></span>Кадастровые участки (при приближении)</div>
        <div class="intro__layers">
          <div class="intro__layers-title">Зонирование территории</div>
          <label class="layer-switch">
            <input type="checkbox" id="pzz-toggle" ${pzzVisible ? 'checked' : ''}>
            <span>Показать зоны ПЗЗ</span>
          </label>
          <div class="pzz-legend">${renderPzzLegend()}</div>
          <p class="pzz-legend__note">Зоны из Правил землепользования и застройки Великого Новгорода и Новгородского муниципального района. Источник: Портал ГИСОГД Новгородской области.</p>
        </div>
      </section>
    `;

    const toggle = panel.querySelector('#pzz-toggle');
    if (toggle) {
      toggle.addEventListener('change', function () {
        pzzVisible = toggle.checked;
        if (!pzzLayer) return;
        if (pzzVisible) {
          pzzLayer.addTo(map);
        } else {
          map.removeLayer(pzzLayer);
        }
      });
    }
  }

  function renderCard(feature) {
    const props = feature.properties;
    panel.innerHTML = `
      <article class="card">
        <button class="card__back" type="button">← К обзору</button>
        <span class="type-badge">${escapeHtml(TYPE_LABELS[props.type] || props.type || 'Объект')}</span>
        <h2>${escapeHtml(props.name)}</h2>
        <dl class="facts">
          ${factRow('Адрес', props.address)}
          ${factRow('Управляющий', props.manager)}
          ${factRow('Современное использование', props.current_use)}
          ${factRow('Транспортная доступность', capitalize(props.transport))}
        </dl>
        <div class="gallery" aria-label="Фотографии объекта"></div>
      </article>
    `;
    panel.querySelector('.card__back').addEventListener('click', reset);
  }

  function pzzCategory(props) {
    const name = String(props.name_by_doc || '');
    if (/Специальная историческая зона/i.test(name)) return PZZ_HISTORIC.label;
    if (/кладбищ/i.test(name)) return PZZ_CEMETERY.label;
    return PZZ_STYLES[props.type_zone] ? PZZ_STYLES[props.type_zone].label : props.type_zone;
  }

  function renderPzzCard(props) {
    panel.innerHTML = `
      <article class="card pzz-card">
        <button class="card__back" type="button">← К обзору</button>
        <span class="type-badge">Зона ПЗЗ</span>
        <h2>${escapeHtml(props.name_by_doc || 'Зона без названия')}</h2>
        <dl class="facts">
          ${factRow('Категория', pzzCategory(props))}
          ${factRow('Тип зоны', props.type_zone)}
          ${factRow('Регистрационный номер', props.reg_numb_border)}
          ${factRow('Источник', 'Портал ГИСОГД Новгородской области')}
        </dl>
        <p class="pzz-card__note">Нажмите «К обзору» или клавишу Esc, чтобы вернуться к списку.</p>
      </article>
    `;
    panel.querySelector('.card__back').addEventListener('click', reset);
  }

  function selectPzz(props) {
    ++selectionToken;
    setActive(null);
    renderPzzCard(props);
  }

  function renderPlotPanel(props) {
    const plots = cadastrePlots.get(props.monastery_id) || [];
    const chips = plots.map(function (item) {
      const number = item.properties.num;
      const active = number === props.num ? ' is-active' : '';
      return `<button type="button" class="plot-chip${active}" data-plot-num="${escapeHtml(number)}">` +
        `${escapeHtml(number)}</button>`;
    }).join('');

    plotPanel.innerHTML = `
      <div class="plot-panel__head">
        <div>
          <div class="plot-panel__label">Кадастровый участок · ${escapeHtml(props.name_of_mon || '')}</div>
          <h2>${escapeHtml(props.num || '—')}</h2>
        </div>
        <button class="plot-panel__close" type="button" aria-label="Закрыть">×</button>
      </div>
      <dl class="plot-panel__facts">
        ${factRow('Категория земель', props.category)}
        ${factRow('Разрешённое использование', props.allowed)}
        ${factRow('Форма собственности', props.ownership)}
        ${factRow('Площадь', formatArea(props.area_m2))}
        ${factRow('Тип территории', props.surroundings ? 'Окружение монастыря' : 'Территория монастыря')}
      </dl>
      <div class="plot-panel__other">
        <div class="plot-panel__other-title">Участков у объекта: ${plots.length}</div>
        <div class="plot-panel__chips">${chips}</div>
      </div>
      <button class="plot-panel__monastery" type="button">Открыть карточку монастыря →</button>
    `;

    plotPanel.querySelector('.plot-panel__close').addEventListener('click', closePlotPanel);

    plotPanel.querySelectorAll('.plot-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        selectPlotByNumber(chip.dataset.plotNum);
      });
    });

    plotPanel.querySelector('.plot-panel__monastery').addEventListener('click', function () {
      const feature = monasteryFeatures.get(props.monastery_id);
      if (feature) select(feature, markers.get(props.monastery_id));
    });
  }

  function selectPlot(feature, layer) {
    if (selectedPlotLayer) {
      selectedPlotLayer.setStyle(cadastreStyle(selectedPlotLayer.feature));
    }
    selectedPlotLayer = layer;
    layer.setStyle(CADASTRE_ACTIVE);
    renderPlotPanel(feature.properties);
    plotPanel.hidden = false;
  }

  function selectPlotByNumber(number) {
    const layer = plotLayers.get(number);
    if (!layer) return;
    map.panTo(layer.getBounds().getCenter(), { animate: true });
    selectPlot(layer.feature, layer);
  }

  function closePlotPanel() {
    plotPanel.hidden = true;
    if (selectedPlotLayer) {
      selectedPlotLayer.setStyle(cadastreStyle(selectedPlotLayer.feature));
      selectedPlotLayer = null;
    }
  }

  function syncZoomMode() {
    const showCadastre = map.getZoom() >= CADASTRE_ZOOM;

    if (showCadastre && markersVisible) {
      markers.forEach(function (marker) { map.removeLayer(marker); });
      markersVisible = false;
    } else if (!showCadastre && !markersVisible) {
      markers.forEach(function (marker) { marker.addTo(map); });
      markersVisible = true;
      closePlotPanel();
    }

    if (!cadastreLayer) return;
    if (showCadastre && !map.hasLayer(cadastreLayer)) {
      cadastreLayer.addTo(map);
    } else if (!showCadastre && map.hasLayer(cadastreLayer)) {
      map.removeLayer(cadastreLayer);
    }
  }

  function openLightbox(paths, index) {
    lightboxPaths = paths.slice();
    lightboxIndex = index;
    lightbox.hidden = false;
    document.body.classList.add('is-lightbox-open');
    showLightboxImage();
  }

  function showLightboxImage() {
    const image = lightbox.querySelector('img');
    const caption = lightbox.querySelector('figcaption');
    image.src = lightboxPaths[lightboxIndex];
    image.alt = `Фотография ${lightboxIndex + 1} из ${lightboxPaths.length}`;
    caption.textContent = `${lightboxIndex + 1} / ${lightboxPaths.length}`;

    const multiple = lightboxPaths.length > 1;
    lightbox.querySelector('.lightbox__nav--prev').hidden = !multiple;
    lightbox.querySelector('.lightbox__nav--next').hidden = !multiple;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    lightboxPaths = [];
    lightbox.querySelector('img').src = '';
    document.body.classList.remove('is-lightbox-open');
  }

  function stepLightbox(step) {
    if (lightboxPaths.length < 2) return;
    lightboxIndex = (lightboxIndex + step + lightboxPaths.length) % lightboxPaths.length;
    showLightboxImage();
  }

  function imageCandidates(id) {
    const candidates = [`images/${id}.jpg`, `images/${id}.jpeg`];
    for (let index = 1; index <= 8; index += 1) {
      candidates.push(`images/${id}-${index}.jpg`, `images/${id}-${index}.jpeg`);
    }
    return candidates;
  }

  function probeImage(src) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve(src); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  async function fillGallery(id, token) {
    const manifest = window.GALLERY_IMAGES && window.GALLERY_IMAGES[String(id)];
    const paths = [];

    if (Array.isArray(manifest)) {
      manifest.forEach(function (src) { paths.push(src); });
    } else {
      const results = await Promise.all(imageCandidates(id).map(probeImage));
      const used = new Set();
      results.forEach(function (src) {
        if (!src) return;
        const key = src.replace(/\.jpe?g$/, '');
        if (used.has(key)) return;
        used.add(key);
        paths.push(src);
      });
    }

    if (token !== selectionToken) return;

    const gallery = panel.querySelector('.gallery');
    if (!gallery) return;

    gallery.innerHTML = paths
      .map(function (src) {
        return `<img src="${escapeHtml(src)}" alt="Фотография объекта" loading="lazy">`;
      })
      .join('');

    gallery.querySelectorAll('img').forEach(function (img, index) {
      img.addEventListener('error', function () { img.remove(); }, { once: true });
      img.addEventListener('click', function () { openLightbox(paths, index); });
    });
  }

  async function loadData() {
    const urls = ['data/monasteries.geojson', 'data/deepseek_json_20261123_d5d4d4.json'];
    for (const url of urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const data = await response.json();
        if (data && Array.isArray(data.features)) return data;
      } catch (error) {
        // Пробуем следующий источник.
      }
    }
    if (window.MONASTERIES_DATA && Array.isArray(window.MONASTERIES_DATA.features)) {
      return window.MONASTERIES_DATA;
    }
    throw new Error('Не удалось загрузить данные карты');
  }

  async function loadBoundary() {
    if (window.CITY_BOUNDARY) return window.CITY_BOUNDARY;
    const response = await fetch('data/city-boundary.geojson');
    if (!response.ok) throw new Error('Не удалось загрузить границу города');
    return response.json();
  }

  async function loadPZZ() {
    if (window.PZZ_DATA && Array.isArray(window.PZZ_DATA.features)) return window.PZZ_DATA;
    const response = await fetch('data/pzz.geojson');
    if (!response.ok) throw new Error('Не удалось загрузить зоны ПЗЗ');
    return response.json();
  }

  async function loadKadastre() {
    if (window.KADASTER_DATA && Array.isArray(window.KADASTER_DATA.features)) return window.KADASTER_DATA;
    const response = await fetch('data/kadaster-plots.geojson');
    if (!response.ok) throw new Error('Не удалось загрузить кадастровые участки');
    return response.json();
  }

  function setActive(id, marker) {
    if (activeId !== null && markers.has(activeId)) {
      const previous = markers.get(activeId);
      previous.setRadius(8);
      previous.setStyle({ fillColor: COLORS.base, color: '#ffffff', weight: 2 });
    }

    activeId = id;

    if (marker) {
      marker.setRadius(12);
      marker.setStyle({ fillColor: COLORS.active, color: COLORS.activeBorder, weight: 3 });
    }
  }

  function select(feature, marker) {
    setActive(feature.properties.id, marker);
    renderCard(feature);

    const token = ++selectionToken;
    fillGallery(feature.properties.id, token);

    const [lng, lat] = feature.geometry.coordinates;
    map.flyTo([lat, lng], FOCUS_ZOOM, { duration: 1.1 });
  }

  function reset() {
    ++selectionToken;
    setActive(null);
    closePlotPanel();
    renderIntro();
    map.flyTo(OVERVIEW.center, OVERVIEW.zoom, { duration: 0.9 });
  }

  function addMarkers(features) {
    features.forEach(function (feature) {
      const props = feature.properties;
      const [lng, lat] = feature.geometry.coordinates;

      const marker = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: COLORS.base,
        fillOpacity: 1
      }).addTo(map);

      marker.bindTooltip(escapeHtml(props.name), {
        direction: 'top',
        offset: [0, -8],
        className: 'monastery-label'
      });

      marker.on('mouseover', function () {
        if (activeId !== props.id) marker.setStyle({ fillColor: COLORS.hover });
      });

      marker.on('mouseout', function () {
        if (activeId !== props.id) marker.setStyle({ fillColor: COLORS.base });
      });

      marker.on('click', function (event) {
        ignoreMapClick = true;
        if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
        window.setTimeout(function () { ignoreMapClick = false; }, 0);
        select(feature, marker);
      });

      markers.set(props.id, marker);
    });
  }

  function init() {
    map = L.map('map', {
      center: OVERVIEW.center,
      zoom: OVERVIEW.zoom,
      zoomControl: false
    });

    map.createPane('baseSchematic');
    map.getPane('baseSchematic').style.zIndex = 300;
    map.getPane('baseSchematic').style.pointerEvents = 'none';

    map.createPane('baseTiles');
    map.getPane('baseTiles').style.zIndex = 350;
    map.getPane('baseTiles').style.pointerEvents = 'none';

    map.createPane('pzzZones');
    map.getPane('pzzZones').style.zIndex = 370;
    map.getPane('pzzZones').style.pointerEvents = 'auto';

    map.createPane('cityBoundary');
    map.getPane('cityBoundary').style.zIndex = 380;
    map.getPane('cityBoundary').style.pointerEvents = 'none';

    map.createPane('cadastre');
    map.getPane('cadastre').style.zIndex = 390;
    map.getPane('cadastre').style.pointerEvents = 'auto';

    const baseMapBounds = [
      [58.35, 31.10],
      [58.65, 31.43]
    ];

    L.imageOverlay('data/basemap.svg', baseMapBounds, {
      pane: 'baseSchematic',
      attribution: 'Карта-схема монастырей Великого Новгорода',
      interactive: false
    }).addTo(map);

    const tileProviders = [
      {
        url: 'https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png',
        options: {
          pane: 'baseTiles',
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://www.openstreetmap.de/">ÖPNVKarte</a>'
        }
      },
      {
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        options: {
          pane: 'baseTiles',
          subdomains: 'abc',
          maxZoom: 17,
          attribution: '&copy; <a href="https://opentopomap.org/">OpenTopoMap</a>, &copy; OpenStreetMap contributors'
        }
      },
      {
        url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
        options: {
          pane: 'baseTiles',
          subdomains: 'abc',
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap France, &copy; OpenStreetMap contributors'
        }
      },
      {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        options: {
          pane: 'baseTiles',
          subdomains: 'abcd',
          maxZoom: 19,
          attribution: '&copy; CARTO, &copy; OpenStreetMap contributors'
        }
      },
      {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: {
          pane: 'baseTiles',
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors'
        }
      }
    ];

    let tileErrors = 0;
    let tileLayer = null;
    let providerWorking = false;

    function addTileProvider(index) {
      if (index >= tileProviders.length) return;

      const provider = tileProviders[index];
      tileErrors = 0;
      providerWorking = false;
      tileLayer = L.tileLayer(provider.url, provider.options).addTo(map);

      tileLayer.on('tileload', function () {
        providerWorking = true;
      });

      tileLayer.on('tileerror', function () {
        if (providerWorking) return;
        tileErrors += 1;
        if (tileErrors >= 3) {
          map.removeLayer(tileLayer);
          addTileProvider(index + 1);
        }
      });
    }

    addTileProvider(0);

    loadBoundary()
      .then(function (boundary) {
        L.geoJSON(boundary, {
          pane: 'cityBoundary',
          interactive: false,
          style: {
            color: '#8b3a2e',
            weight: 2,
            dashArray: '6 5',
            opacity: 0.9,
            fillColor: '#c0392b',
            fillOpacity: 0.06
          }
        }).addTo(map);
      })
      .catch(function (error) {
        console.error(error);
      });

    loadPZZ()
      .then(function (data) {
        pzzLayer = L.geoJSON(data, {
          pane: 'pzzZones',
          interactive: true,
          style: pzzStyle
        });
        pzzLayer.on('click', function (event) {
          ignoreMapClick = true;
          if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
          window.setTimeout(function () { ignoreMapClick = false; }, 0);
          selectPzz(event.layer.feature.properties);
        });
        if (pzzVisible) pzzLayer.addTo(map);
      })
      .catch(function (error) {
        console.error(error);
      });

    loadKadastre()
      .then(function (data) {
        data.features.forEach(function (feature) {
          const id = feature.properties.monastery_id;
          if (!cadastrePlots.has(id)) cadastrePlots.set(id, []);
          cadastrePlots.get(id).push(feature);
        });
        cadastrePlots.forEach(function (list) {
          list.sort(function (a, b) {
            return String(a.properties.num).localeCompare(String(b.properties.num));
          });
        });

        cadastreLayer = L.geoJSON(data, {
          pane: 'cadastre',
          interactive: true,
          style: cadastreStyle
        });

        cadastreLayer.eachLayer(function (layer) {
          plotLayers.set(layer.feature.properties.num, layer);
        });

        cadastreLayer.on('click', function (event) {
          ignoreMapClick = true;
          if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
          window.setTimeout(function () { ignoreMapClick = false; }, 0);
          selectPlot(event.layer.feature, event.layer);
        });

        cadastreLayer.on('mouseover', function (event) {
          if (event.layer !== selectedPlotLayer) {
            event.layer.setStyle({ fillOpacity: 0.65 });
          }
        });

        cadastreLayer.on('mouseout', function (event) {
          if (event.layer !== selectedPlotLayer) {
            event.layer.setStyle(cadastreStyle(event.layer.feature));
          }
        });

        syncZoomMode();
      })
      .catch(function (error) {
        console.error(error);
      });

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('click', function () {
      if (ignoreMapClick) {
        ignoreMapClick = false;
        return;
      }
      reset();
    });
    map.on('zoomend', syncZoomMode);

    lightbox.querySelector('.lightbox__close').addEventListener('click', closeLightbox);
    lightbox.querySelector('.lightbox__nav--prev').addEventListener('click', function (event) {
      event.stopPropagation();
      stepLightbox(-1);
    });
    lightbox.querySelector('.lightbox__nav--next').addEventListener('click', function (event) {
      event.stopPropagation();
      stepLightbox(1);
    });
    lightbox.addEventListener('click', function (event) {
      if (event.target === lightbox || event.target.classList.contains('lightbox__figure')) {
        closeLightbox();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (!lightbox.hidden) {
        if (event.key === 'Escape') {
          closeLightbox();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          stepLightbox(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          stepLightbox(1);
        }
        return;
      }

      if (event.key !== 'Escape') return;
      if (!plotPanel.hidden) {
        closePlotPanel();
        return;
      }
      reset();
    });

    renderIntro();

    loadData()
      .then(function (data) {
        data.features.forEach(function (feature) {
          monasteryFeatures.set(feature.properties.id, feature);
        });
        addMarkers(data.features);
      })
      .catch(function (error) {
        console.error(error);
        panel.innerHTML =
          '<div class="error"><strong>Не удалось загрузить карту</strong>' +
          'Проверьте файл data/monasteries.geojson или откройте сайт через локальный сервер.</div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
