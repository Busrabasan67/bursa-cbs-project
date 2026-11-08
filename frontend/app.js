// Backend API Adresi
const API_BASE_URL = "http://localhost:5298/api";

// Altlık Harita Stilleri
const BASEMAP_STYLES = {
    positron: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    osm: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
};

let currentBasemap = "positron";
let selectedHospital = null;
let activePopup = null;

// Önbellekteki Veriler
let cachedDistrictsData = null;
let cachedHospitalsData = null;
let allHospitalsFeatures = [];
let cachedDrawingsData = null;

// Çizim Durumu
let drawState = {
    mode: null, // null | "Point" | "LineString" | "Polygon" | "edit-geometry"
    isAnalysisPolygon: false,
    isMeasureMode: false,
    coords: [],
    cursorCoord: null,
    pendingGeometry: null,
    editingFeature: null,
    vertexMarkers: []
};

// Geometrik Analiz Durumu (Madde 4)
let analysisState = {
    activeMode: null, // null | "nearest" | "buffer-point"
    lastOrigin: null, // { lat, lng }
    originMarker: null,
    linesGeoJson: null,
    polygonGeoJson: null,
    hospitalsGeoJson: null,
    choroplethGeoJson: null
};

// 1. Haritayı Başlat
const map = new maplibregl.Map({
    container: "map",
    style: BASEMAP_STYLES.positron,
    center: [29.061, 40.188],
    zoom: 11
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

map.on("load", async () => {
    await fetchAllData();
    ensureAllLayersAdded();
});

// Altlık harita değiştiğinde katmanların kaybolmaması için otomatik geri yükleyici
["style.load", "styledata", "idle"].forEach((evt) => {
    map.on(evt, () => {
        try {
            ensureAllLayersAdded();
        } catch {
            // Stil geçiş aşamasındaysa bir sonraki adımda tamamlanır
        }
    });
});

// ----------------------------------------------------
// Sekme (Tab) Geçişleri
// ----------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tab");
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

        btn.classList.add("active");
        document.getElementById(target)?.classList.add("active");
    });
});

// ----------------------------------------------------
// Veri Çekme İşlemleri
// ----------------------------------------------------
async function fetchAllData() {
    try {
        const [distRes, hospRes, drawRes] = await Promise.all([
            fetch(`${API_BASE_URL}/districts`),
            fetch(`${API_BASE_URL}/hospitals`),
            fetch(`${API_BASE_URL}/userdrawings`).catch(() => null)
        ]);

        if (distRes.ok) {
            cachedDistrictsData = await distRes.json();
            populateDistrictFilter(cachedDistrictsData.features);
        }

        if (hospRes.ok) {
            cachedHospitalsData = await hospRes.json();
            allHospitalsFeatures = cachedHospitalsData.features || [];
            renderHospitalsList(cachedHospitalsData.features);
        }

        if (drawRes && drawRes.ok) {
            cachedDrawingsData = await drawRes.json();
            renderDrawingsList();
        }

        populateAnalysisPolygonSelector();
    } catch (err) {
        console.error("Veri çekme hatası:", err);
    }
}

async function refreshUserDrawings() {
    try {
        const res = await fetch(`${API_BASE_URL}/userdrawings`);
        if (res.ok) {
            cachedDrawingsData = await res.json();
            if (map.getSource("drawings-source")) {
                applyDrawingsMapFilter(currentDrawingTypeFilter, false);
            } else {
                ensureAllLayersAdded();
            }
            renderDrawingsList();
            populateAnalysisPolygonSelector();
        }
    } catch (err) {
        console.error("Çizim yenileme hatası:", err);
    }
}

// ----------------------------------------------------
// Harita Katmanlarını Kurma & Koruma
// ----------------------------------------------------
function ensureAllLayersAdded() {
    if (!map.style) return;

    const districtsVis = document.getElementById("layer-districts")?.checked !== false ? "visible" : "none";
    const hospitalsVis = document.getElementById("layer-hospitals")?.checked !== false ? "visible" : "none";
    const drawingsVis = document.getElementById("layer-drawings")?.checked !== false ? "visible" : "none";
    const wmsVis = document.getElementById("layer-wms")?.checked === true ? "visible" : "none";
    const isDark = currentBasemap === "dark";

    // 0. Harici OGC/BBOX Raster Servisi (Madde 5 - ArcGIS Yüksek Çözünürlüklü Hava / Uydu Raster Servisi)
    if (!map.getSource("wms-topo-source")) {
        map.addSource("wms-topo-source", {
            type: "raster",
            tiles: [
                "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image"
            ],
            tileSize: 256,
            attribution: "© Esri, Maxar, Earthstar Geographics"
        });

        const beforeLayerId = map.getLayer("districts-fill") ? "districts-fill" : undefined;
        map.addLayer(
            {
                id: "wms-topo-layer",
                type: "raster",
                source: "wms-topo-source",
                layout: { visibility: wmsVis },
                paint: {
                    "raster-opacity": 0.95
                }
            },
            beforeLayerId
        );
    }

    // 1. İlçeler
    if (cachedDistrictsData && !map.getSource("districts-source")) {
        map.addSource("districts-source", { type: "geojson", data: cachedDistrictsData });

        map.addLayer({
            id: "districts-fill",
            type: "fill",
            source: "districts-source",
            layout: { visibility: districtsVis },
            paint: {
                "fill-color": "#3b82f6",
                "fill-opacity": isDark ? 0.18 : 0.12
            }
        });

        map.addLayer({
            id: "districts-line",
            type: "line",
            source: "districts-source",
            layout: { visibility: districtsVis },
            paint: {
                "line-color": isDark ? "#60a5fa" : "#2563eb",
                "line-width": 1.5,
                "line-dasharray": [2, 1]
            }
        });
    }

    // 2. Hastaneler
    if (cachedHospitalsData && !map.getSource("hospitals-source")) {
        map.addSource("hospitals-source", { type: "geojson", data: cachedHospitalsData });

        map.addLayer({
            id: "hospitals-circle",
            type: "circle",
            source: "hospitals-source",
            layout: { visibility: hospitalsVis },
            paint: {
                "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 6, 14, 10],
                "circle-color": "#ef4444",
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff"
            }
        });

        map.addLayer({
            id: "hospitals-label",
            type: "symbol",
            source: "hospitals-source",
            minzoom: 11.5,
            layout: {
                visibility: hospitalsVis,
                "text-field": ["get", "name"],
                "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
                "text-size": 11,
                "text-offset": [0, 1.3],
                "text-anchor": "top",
                "text-max-width": 12
            },
            paint: {
                "text-color": isDark ? "#f8fafc" : "#1e293b",
                "text-halo-color": isDark ? "#0f172a" : "#ffffff",
                "text-halo-width": 2
            }
        });
    }

    // 3. Kullanıcı Çizimleri
    if (cachedDrawingsData && !map.getSource("drawings-source")) {
        map.addSource("drawings-source", { type: "geojson", data: cachedDrawingsData });

        map.addLayer({
            id: "drawings-fill",
            type: "fill",
            source: "drawings-source",
            filter: ["==", "$type", "Polygon"],
            layout: { visibility: drawingsVis },
            paint: { "fill-color": "#10b981", "fill-opacity": 0.35 }
        });

        map.addLayer({
            id: "drawings-line",
            type: "line",
            source: "drawings-source",
            layout: { visibility: drawingsVis },
            paint: { "line-color": "#059669", "line-width": 3.5 }
        });

        map.addLayer({
            id: "drawings-circle",
            type: "circle",
            source: "drawings-source",
            filter: ["==", "$type", "Point"],
            layout: { visibility: drawingsVis },
            paint: {
                "circle-radius": 8,
                "circle-color": "#10b981",
                "circle-stroke-width": 2,
                "circle-stroke-color": "#ffffff"
            }
        });

        map.addLayer({
            id: "drawings-label",
            type: "symbol",
            source: "drawings-source",
            layout: {
                visibility: drawingsVis,
                "text-field": ["get", "name"],
                "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
                "text-size": 11,
                "text-offset": [0, 1.2],
                "text-anchor": "top"
            },
            paint: {
                "text-color": isDark ? "#6ee7b7" : "#065f46",
                "text-halo-color": isDark ? "#0f172a" : "#ffffff",
                "text-halo-width": 2
            }
        });
    }

    // 4. Canlı Çizim Önizleme Katmanı
    if (!map.getSource("sketch-source")) {
        map.addSource("sketch-source", {
            type: "geojson",
            data: buildSketchFeatureCollection()
        });

        map.addLayer({
            id: "sketch-fill",
            type: "fill",
            source: "sketch-source",
            filter: ["==", "$type", "Polygon"],
            paint: { "fill-color": "#10b981", "fill-opacity": 0.25 }
        });

        map.addLayer({
            id: "sketch-line",
            type: "line",
            source: "sketch-source",
            filter: ["==", "$type", "LineString"],
            paint: { "line-color": "#059669", "line-width": 3, "line-dasharray": [2, 2] }
        });

        map.addLayer({
            id: "sketch-points",
            type: "circle",
            source: "sketch-source",
            filter: ["==", "$type", "Point"],
            paint: {
                "circle-radius": 6,
                "circle-color": "#ffffff",
                "circle-stroke-width": 3,
                "circle-stroke-color": "#059669"
            }
        });
    }

    // 5. Geometrik Analiz Görselleştirme Katmanları (Poligon, Bağlantı Çizgileri ve Vurgular)
    const beforeHospitals = map.getLayer("hospitals-circle") ? "hospitals-circle" : undefined;

    if (analysisState.polygonGeoJson && !map.getSource("analysis-polygon-source")) {
        map.addSource("analysis-polygon-source", {
            type: "geojson",
            data: analysisState.polygonGeoJson
        });

        map.addLayer({
            id: "analysis-polygon-fill",
            type: "fill",
            source: "analysis-polygon-source",
            paint: {
                "fill-color": "#2563eb",
                "fill-opacity": 0.14
            }
        }, beforeHospitals);

        map.addLayer({
            id: "analysis-polygon-outline",
            type: "line",
            source: "analysis-polygon-source",
            paint: {
                "line-color": "#1d4ed8",
                "line-width": 2.5
            }
        }, beforeHospitals);
    }

    if (analysisState.linesGeoJson && !map.getSource("analysis-lines-source")) {
        map.addSource("analysis-lines-source", {
            type: "geojson",
            data: analysisState.linesGeoJson
        });

        map.addLayer({
            id: "analysis-lines-layer",
            type: "line",
            source: "analysis-lines-source",
            paint: {
                "line-color": "#2563eb",
                "line-width": 2,
                "line-dasharray": [2, 2]
            }
        }, beforeHospitals);

        map.addLayer({
            id: "analysis-lines-label",
            type: "symbol",
            source: "analysis-lines-source",
            layout: {
                "symbol-placement": "line-center",
                "text-field": ["get", "distanceFormatted"],
                "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
                "text-size": 11,
                "text-offset": [0, -0.6]
            },
            paint: {
                "text-color": isDark ? "#bfdbfe" : "#1e3a8a",
                "text-halo-color": isDark ? "#0f172a" : "#ffffff",
                "text-halo-width": 2
            }
        });
    }

    if (analysisState.hospitalsGeoJson && !map.getSource("analysis-points-source")) {
        map.addSource("analysis-points-source", {
            type: "geojson",
            data: analysisState.hospitalsGeoJson
        });

        map.addLayer({
            id: "analysis-points-halo",
            type: "circle",
            source: "analysis-points-source",
            paint: {
                "circle-radius": 13,
                "circle-color": "#2563eb",
                "circle-opacity": 0.2,
                "circle-stroke-width": 2,
                "circle-stroke-color": "#2563eb"
            }
        }, beforeHospitals);
    }

    if (analysisState.choroplethGeoJson && !map.getSource("analysis-choropleth-source")) {
        map.addSource("analysis-choropleth-source", {
            type: "geojson",
            data: analysisState.choroplethGeoJson
        });

        map.addLayer({
            id: "analysis-choropleth-fill",
            type: "fill",
            source: "analysis-choropleth-source",
            paint: {
                "fill-color": ["get", "fillColor"],
                "fill-opacity": 0.65
            }
        }, beforeHospitals);

        map.addLayer({
            id: "analysis-choropleth-outline",
            type: "line",
            source: "analysis-choropleth-source",
            paint: {
                "line-color": isDark ? "#f8fafc" : "#334155",
                "line-width": 1.6
            }
        }, beforeHospitals);
    }
}

// Altlık Harita Seçimi
document.querySelectorAll(".basemap-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
        const targetBtn = e.currentTarget;
        document.querySelectorAll(".basemap-btn").forEach(b => b.classList.remove("active"));
        targetBtn.classList.add("active");

        currentBasemap = targetBtn.getAttribute("data-style");
        map.setStyle(BASEMAP_STYLES[currentBasemap]);
    });
});

// Katman Aç/Kapat Çipleri
function setupLayerToggle(checkboxId, layerIds) {
    const checkbox = document.getElementById(checkboxId);
    checkbox.addEventListener("change", (e) => {
        const vis = e.target.checked ? "visible" : "none";
        checkbox.closest(".chip")?.classList.toggle("active", e.target.checked);
        layerIds.forEach(id => {
            if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
        });
    });
}

setupLayerToggle("layer-districts", ["districts-fill", "districts-line"]);
setupLayerToggle("layer-hospitals", ["hospitals-circle", "hospitals-label"]);
setupLayerToggle("layer-drawings", ["drawings-fill", "drawings-line", "drawings-circle", "drawings-label"]);
setupLayerToggle("layer-wms", ["wms-topo-layer"]);

// ----------------------------------------------------
// Hastane Arama, Filtreleme ve Listeleme
// ----------------------------------------------------
function populateDistrictFilter(districts) {
    const select = document.getElementById("district-filter");
    select.innerHTML = '<option value="">Tüm İlçeler</option>';
    const uniqueNames = [...new Set(districts.map(d => d.properties.name))].sort();
    uniqueNames.forEach(name => {
        if (name) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        }
    });
}

async function filterHospitals() {
    try {
        const searchQuery = document.getElementById("search-input").value.trim();
        const districtFilter = document.getElementById("district-filter").value;
        const emergencyOnly = document.getElementById("filter-emergency").checked;

        let url = `${API_BASE_URL}/hospitals`;
        const params = new URLSearchParams();
        if (searchQuery) params.append("search", searchQuery);
        if (districtFilter) params.append("district", districtFilter);
        if (emergencyOnly) params.append("onlyEmergency", "true");
        if (params.toString()) url += `?${params.toString()}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Arama başarısız");
        const data = await res.json();

        cachedHospitalsData = data;
        if (map.getSource("hospitals-source")) {
            map.getSource("hospitals-source").setData(data);
        } else {
            ensureAllLayersAdded();
        }

        renderHospitalsList(data.features);

        if (data.features.length === 1) {
            const coord = data.features[0].geometry.coordinates.slice();
            map.flyTo({ center: coord, zoom: 15, speed: 1.2 });
            showHospitalPopup(data.features[0].properties, coord);
        } else if (data.features.length > 1 && (searchQuery || districtFilter || emergencyOnly)) {
            const bounds = new maplibregl.LngLatBounds();
            data.features.forEach(f => bounds.extend(f.geometry.coordinates));
            map.fitBounds(bounds, { padding: 70, maxZoom: 13, speed: 1.2 });
        }
    } catch (err) {
        console.error("Filtreleme hatası:", err);
    }
}

function renderHospitalsList(features) {
    const listEl = document.getElementById("search-results-list");
    const countEl = document.getElementById("search-results-count");
    countEl.innerText = `${features.length} hastane listeleniyor`;
    listEl.innerHTML = "";

    if (features.length === 0) {
        listEl.innerHTML = `<div style="padding: 12px; font-size: 0.8rem; color: #94a3b8; text-align: center;">Sonuç bulunamadı.</div>`;
        return;
    }

    features.forEach(f => {
        const props = f.properties;
        const coords = f.geometry.coordinates.slice();
        props._coordinates = coords;

        const card = document.createElement("div");
        card.className = "list-card";
        card.innerHTML = `
            <div class="list-card-info">
                <div class="list-card-title">${props.name}</div>
                <div class="list-card-sub">
                    ${props.district || "Bursa"} ${props.emergency === "yes" ? "• 🚑 Acil Var" : ""}
                </div>
            </div>
            <div class="list-card-actions">
                <button class="icon-btn edit" title="Bilgileri Düzenle"><i class="fa-solid fa-pen"></i></button>
            </div>
        `;

        card.addEventListener("click", (e) => {
            if (e.target.closest(".icon-btn")) return;
            map.flyTo({ center: coords, zoom: 15, speed: 1.2 });
            showHospitalPopup(props, coords);
        });

        card.querySelector(".icon-btn.edit").addEventListener("click", (e) => {
            e.stopPropagation();
            openHospitalEditModal(props);
        });

        listEl.appendChild(card);
    });
}

let searchTimeout;
document.getElementById("search-input").addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(filterHospitals, 250);
});
document.getElementById("district-filter").addEventListener("change", filterHospitals);
document.getElementById("filter-emergency").addEventListener("change", filterHospitals);
document.getElementById("btn-filter-clear").addEventListener("click", () => {
    document.getElementById("search-input").value = "";
    document.getElementById("district-filter").value = "";
    document.getElementById("filter-emergency").checked = false;
    filterHospitals();
});

// ----------------------------------------------------
// Harita Popup'ları (Düzenle & Sil Doğrudan Popup İçinde!)
// ----------------------------------------------------
function formatHospitalOperatorTR(props) {
    const op = (props.operatorName || "").trim();
    const opType = (props.operatorType || "").trim().toLowerCase();
    const nameLower = (props.name || "").toLowerCase();

    let typeTR = "";
    if (opType === "government" || opType === "public") typeTR = "Kamu";
    else if (opType === "private") typeTR = "Özel";
    else if (opType === "university") typeTR = "Üniversite";

    if (op && typeTR) return `${op} (${typeTR})`;
    if (op) return op;
    if (typeTR) return `${typeTR} Sağlık Tesisi`;

    if (nameLower.includes("üniversite")) return "Üniversite Hastanesi (Kamu)";
    if (
        nameLower.includes("devlet") ||
        nameLower.includes("şehir hastanesi") ||
        nameLower.includes("eğitim ve araştırma") ||
        nameLower.includes("yüksek ihtisas") ||
        nameLower.includes("dörtçelik") ||
        nameLower.includes("ağız ve diş sağlığı merkezi") ||
        nameLower.includes("asker hastanesi") ||
        nameLower.includes("verem savaş")
    ) {
        return "Sağlık Bakanlığı (Kamu)";
    }
    return "Özel Sağlık Tesisi";
}

function formatHospitalSpecialityTR(props) {
    const spec = (props.speciality || "").trim().toLowerCase();
    const nameLower = (props.name || "").toLowerCase();

    const specMap = {
        general: "Genel Hastane",
        paediatrics: "Çocuk Sağlığı ve Hastalıkları",
        child: "Çocuk Sağlığı ve Hastalıkları",
        oncology: "Onkoloji",
        rehabilitation: "Fizik Tedavi ve Rehabilitasyon",
        physiatry: "Fizik Tedavi ve Rehabilitasyon",
        dental: "Ağız ve Diş Sağlığı",
        gynaecology: "Kadın Hastalıkları ve Doğum",
        maternity: "Kadın Hastalıkları ve Doğum",
        orthopaedics: "Ortopedi ve Travmatoloji",
        psychiatry: "Ruh Sağlığı ve Hastalıkları",
        ophthalmology: "Göz Hastalıkları",
        cardiology: "Kalp ve Damar Hastalıkları"
    };

    if (spec && specMap[spec]) return specMap[spec];
    if (spec) return props.speciality;

    if (nameLower.includes("ağız ve diş") || nameLower.includes("diş hastanesi")) return "Ağız ve Diş Sağlığı";
    if (nameLower.includes("çocuk")) return "Çocuk Sağlığı ve Hastalıkları";
    if (nameLower.includes("onkoloji")) return "Onkoloji";
    if (nameLower.includes("fizik tedavi") || nameLower.includes("rehabilitasyon") || nameLower.includes("spastik") || nameLower.includes("rommer"))
        return "Fizik Tedavi ve Rehabilitasyon";
    if (nameLower.includes("kadın doğum") || nameLower.includes("zübeyde hanım")) return "Kadın Doğum ve Çocuk";
    if (nameLower.includes("göğüs")) return "Göğüs Hastalıkları";
    if (nameLower.includes("göz")) return "Göz Hastalıkları";
    return "Genel Sağlık Tesisi";
}

function formatWheelchairTR(wheelchair) {
    if (!wheelchair) return null;
    const w = String(wheelchair).trim().toLowerCase();
    if (w === "yes") return "♿ Uygun";
    if (w === "limited") return "♿ Kısmi Uygun";
    if (w === "no") return "Uygun Değil";
    return wheelchair;
}

function showHospitalPopup(props, coordinates) {
    if (activePopup) activePopup.remove();

    const lng = Array.isArray(coordinates) ? Number(coordinates[0]) : Number(coordinates?.lng);
    const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : Number(coordinates?.lat);
    const coordText = !isNaN(lat) && !isNaN(lng)
        ? `${lat.toFixed(4)}° K, ${lng.toFixed(4)}° D`
        : "-";

    const operatorText = formatHospitalOperatorTR(props);
    const specialityText = formatHospitalSpecialityTR(props);
    const wheelchairText = formatWheelchairTR(props.wheelchair);

    const addressParts = [props.neighbourhood, props.street, props.postcode]
        .filter(x => x && String(x).trim() !== "");
    const fullAddress = addressParts.join(" • ");

    const container = document.createElement("div");
    container.innerHTML = `
        <div class="popup-title">${props.name}</div>
        <div class="popup-info">
            <b>Kurum / Tür:</b> ${operatorText}<br/>
            <b>Uzmanlık:</b> ${specialityText}<br/>
            <b>İlçe:</b> ${props.district || "-"}${props.neighbourhood ? ` (${props.neighbourhood})` : ""}<br/>
            <b>Acil Servis:</b> ${props.emergency === "yes" ? "✅ Var" : "❌ Yok"}${wheelchairText ? ` • <b>Engelli Erişimi:</b> ${wheelchairText}` : ""}<br/>
            <b>Telefon:</b> ${props.phone || "-"}
            ${fullAddress ? `<br/><b>Adres:</b> ${fullAddress}` : ""}
            <br/><b>Koordinat:</b> <span style="font-family: monospace; color: #1e3a8a; font-weight: 600;">${coordText}</span>
            ${props.website ? `<br/><a href="${props.website}" target="_blank">Web Sitesini Aç</a>` : ""}
        </div>
        <div class="popup-actions">
            <button class="popup-btn primary" id="popup-edit-hosp">
                <i class="fa-solid fa-pen"></i> Bilgileri Düzenle
            </button>
        </div>
    `;

    container.querySelector("#popup-edit-hosp").addEventListener("click", () => {
        openHospitalEditModal(props);
    });

    activePopup = new maplibregl.Popup({ offset: 12 })
        .setLngLat(coordinates)
        .setDOMContent(container)
        .addTo(map);
}

function showDrawingPopup(feature, lngLat) {
    if (activePopup) activePopup.remove();
    const props = feature.properties;
    const gType = (props.geometryType || feature.geometry?.type || "").toLowerCase();

    const container = document.createElement("div");
    container.innerHTML = `
        <div class="popup-title" style="color: #065f46;">${props.name || "Kullanıcı Çizimi"}</div>
        <div class="popup-info">
            <b>Tür:</b> ${formatGeometryTypeTR(props.geometryType || feature.geometry?.type)}<br/>
            <b>Açıklama:</b> ${props.description || "-"}
            <div id="popup-measure-info" style="margin-top: 4px; color: #1d4ed8; font-weight: 600;"></div>
        </div>
        <div class="popup-actions">
            <button class="popup-btn primary" id="popup-edit-draw">Düzenle</button>
            <button class="popup-btn" id="popup-move-draw">Taşı</button>
            <button class="popup-btn danger" id="popup-del-draw">Sil</button>
        </div>
    `;

    // Çizgi veya Alan ise metrik uzunluk/alan bilgisini (EPSG:5254) getir
    if (props.id && (gType.includes("line") || gType.includes("polygon"))) {
        fetch(`${API_BASE_URL}/analysis/measure/drawing/${props.id}`)
            .then(r => (r.ok ? r.json() : null))
            .then(m => {
                const infoEl = container.querySelector("#popup-measure-info");
                if (!infoEl || !m) return;
                if (m.lengthFormatted) {
                    infoEl.innerHTML = `<i class="fa-solid fa-ruler-horizontal"></i> Uzunluk: ${m.lengthFormatted}`;
                } else if (m.areaFormatted) {
                    infoEl.innerHTML = `<i class="fa-solid fa-vector-square"></i> Alan: ${m.areaFormatted} • Çevre: ${m.perimeterFormatted}`;
                }
            })
            .catch(() => { });
    }

    container.querySelector("#popup-edit-draw").addEventListener("click", () => {
        openDrawingModalForEdit(feature);
    });
    container.querySelector("#popup-move-draw").addEventListener("click", () => {
        startGeometryEditMode(feature);
    });
    container.querySelector("#popup-del-draw").addEventListener("click", () => {
        deleteUserDrawingById(props.id, props.name);
    });

    activePopup = new maplibregl.Popup({ offset: 10 })
        .setLngLat(lngLat)
        .setDOMContent(container)
        .addTo(map);
}

function showDistrictPopup(props, lngLat) {
    if (activePopup) activePopup.remove();

    const container = document.createElement("div");
    container.innerHTML = `
        <div class="popup-title">${props.name} İlçesi</div>
        <div class="popup-info">
            Bursa İdari İlçe Sınırı
            <div id="popup-dist-measure" style="margin-top: 4px; color: #1d4ed8; font-weight: 600;"></div>
        </div>
    `;

    if (props.id) {
        fetch(`${API_BASE_URL}/analysis/measure/district/${props.id}`)
            .then(r => (r.ok ? r.json() : null))
            .then(m => {
                const infoEl = container.querySelector("#popup-dist-measure");
                if (infoEl && m && m.areaFormatted) {
                    infoEl.innerHTML = `Alan: ${m.areaFormatted} • Çevre: ${m.perimeterFormatted}`;
                }
            })
            .catch(() => { });
    }

    activePopup = new maplibregl.Popup({ offset: 8 })
        .setLngLat(lngLat)
        .setDOMContent(container)
        .addTo(map);
}

function showChoroplethDistrictPopup(props, lngLat) {
    if (activePopup) activePopup.remove();

    const container = document.createElement("div");
    container.innerHTML = `
        <div class="popup-title">${props.name} İlçesi</div>
        <div class="popup-info">
            <b>Toplam Hastane:</b> ${props.hospitalCount} (${props.densityCategory})<br/>
            <b>Acil Servisli:</b> ${props.emergencyCount} Hastane<br/>
            <b>Yüzölçümü:</b> ${Number(props.areaSqKm).toLocaleString("tr-TR")} km²<br/>
            <b>Yoğunluk:</b> ${Number(props.hospitalsPer100SqKm).toLocaleString("tr-TR")} hastane / 100 km²
        </div>
    `;

    activePopup = new maplibregl.Popup({ offset: 8 })
        .setLngLat(lngLat)
        .setDOMContent(container)
        .addTo(map);
}

// Harita Tıklama Yönetimi (Öncelik: Çizim Modu > Analiz Modu > Hastane > Çizim > Tematik İlçe > İlçe)
map.on("click", (e) => {
    if (drawState.mode) {
        handleMapClickInDrawMode(e);
        return;
    }

    if (analysisState.activeMode === "nearest") {
        runNearestHospitalsAnalysis(e.lngLat.lat, e.lngLat.lng);
        return;
    }

    if (analysisState.activeMode === "buffer-point") {
        // Eğer harita üzerinde mevcut bir Hastane veya Kullanıcı Çizimi üzerine tıklandıysa doğrudan o objeyi seçip etrafında tampon oluştur
        if (map.getLayer("hospitals-circle")) {
            const clickedHosps = map.queryRenderedFeatures(e.point, { layers: ["hospitals-circle"] });
            if (clickedHosps.length > 0 && clickedHosps[0].properties?.id) {
                const targetVal = `hospital:${clickedHosps[0].properties.id}`;
                stopNearestPickMode();
                if (bufferSelectDrawing) bufferSelectDrawing.value = targetVal;
                runDrawingBufferAnalysis(targetVal);
                return;
            }
        }

        const activeDrawLayers = ["drawings-circle", "drawings-line", "drawings-fill"].filter(id => map.getLayer(id));
        if (activeDrawLayers.length > 0) {
            const clickedDraws = map.queryRenderedFeatures(e.point, { layers: activeDrawLayers });
            if (clickedDraws.length > 0 && clickedDraws[0].properties?.id) {
                const targetVal = `drawing:${clickedDraws[0].properties.id}`;
                stopNearestPickMode();
                if (bufferSelectDrawing) bufferSelectDrawing.value = targetVal;
                runDrawingBufferAnalysis(targetVal);
                return;
            }
        }

        runPointBufferAnalysis(e.lngLat.lat, e.lngLat.lng);
        return;
    }

    if (map.getLayer("hospitals-circle")) {
        const hosps = map.queryRenderedFeatures(e.point, { layers: ["hospitals-circle"] });
        if (hosps.length > 0) {
            const feat = hosps[0];
            const coords = feat.geometry.coordinates.slice();
            feat.properties._coordinates = coords;
            showHospitalPopup(feat.properties, coords);
            return;
        }
    }

    const drawLayers = ["drawings-circle", "drawings-line", "drawings-fill"].filter(id => map.getLayer(id));
    if (drawLayers.length > 0) {
        const draws = map.queryRenderedFeatures(e.point, { layers: drawLayers });
        if (draws.length > 0) {
            const clickedProps = draws[0].properties;
            const fullFeature = cachedDrawingsData?.features?.find(
                f => String(f.properties.id) === String(clickedProps.id)
            ) || draws[0];
            showDrawingPopup(fullFeature, e.lngLat);
            return;
        }
    }

    if (map.getLayer("analysis-choropleth-fill")) {
        const choro = map.queryRenderedFeatures(e.point, { layers: ["analysis-choropleth-fill"] });
        if (choro.length > 0) {
            showChoroplethDistrictPopup(choro[0].properties, e.lngLat);
            return;
        }
    }

    if (map.getLayer("districts-fill")) {
        const dists = map.queryRenderedFeatures(e.point, { layers: ["districts-fill"] });
        if (dists.length > 0) {
            showDistrictPopup(dists[0].properties, e.lngLat);
        }
    }
});

map.on("mousemove", (e) => {
    if (drawState.mode === "Point" || drawState.mode === "LineString" || drawState.mode === "Polygon") {
        map.getCanvas().style.cursor = "crosshair";
        drawState.cursorCoord = [e.lngLat.lng, e.lngLat.lat];
        refreshSketchLayer();
        return;
    }
    if (drawState.mode === "edit-geometry") return;

    if (analysisState.activeMode === "nearest" || analysisState.activeMode === "buffer-point") {
        map.getCanvas().style.cursor = "crosshair";
        return;
    }

    const layers = ["hospitals-circle", "drawings-circle", "drawings-line", "drawings-fill", "districts-fill"]
        .filter(id => map.getLayer(id));
    const hovered = map.queryRenderedFeatures(e.point, { layers });
    map.getCanvas().style.cursor = hovered.length > 0 ? "pointer" : "";
});

// ----------------------------------------------------
// Çizim Motoru (Nokta, Çizgi, Alan)
// ----------------------------------------------------
function formatGeometryTypeTR(type) {
    if (!type) return "Çizim";
    const t = type.toLowerCase();
    if (t.includes("point")) return "Nokta";
    if (t.includes("line")) return "Çizgi";
    if (t.includes("polygon")) return "Alan (Poligon)";
    return type;
}

function buildSketchFeatureCollection() {
    const features = [];
    const pts = drawState.coords;
    const allPts = drawState.cursorCoord && pts.length > 0 ? [...pts, drawState.cursorCoord] : [...pts];

    pts.forEach(c => {
        features.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} });
    });

    if (drawState.mode === "LineString" && allPts.length >= 2) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: allPts }, properties: {} });
    } else if (drawState.mode === "Polygon" && allPts.length >= 2) {
        features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [...allPts, allPts[0]] }, properties: {} });
        if (allPts.length >= 3) {
            features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...allPts, allPts[0]]] }, properties: {} });
        }
    } else if (drawState.mode === "edit-geometry" && drawState.editingFeature) {
        features.push({ type: "Feature", geometry: drawState.editingFeature.geometry, properties: {} });
        if (drawState.editingFeature.geometry.type === "Polygon") {
            features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: drawState.editingFeature.geometry.coordinates[0] },
                properties: {}
            });
        }
    }

    return { type: "FeatureCollection", features };
}

function refreshSketchLayer() {
    if (map.getSource("sketch-source")) {
        map.getSource("sketch-source").setData(buildSketchFeatureCollection());
    }
}

function startDrawingMode(mode, isAnalysisPolygon = false, isMeasureMode = false) {
    stopDrawingMode();
    if (activePopup) activePopup.remove();

    drawState.mode = mode;
    drawState.isAnalysisPolygon = isAnalysisPolygon;
    drawState.isMeasureMode = isMeasureMode;
    drawState.coords = [];
    drawState.cursorCoord = null;
    map.doubleClickZoom.disable();

    document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
    if (isMeasureMode) {
        if (mode === "LineString") document.getElementById("btn-measure-line")?.classList.add("active");
        if (mode === "Polygon") document.getElementById("btn-measure-polygon")?.classList.add("active");
    } else if (isAnalysisPolygon) {
        document.getElementById("btn-draw-analysis-polygon")?.classList.add("active");
    } else {
        if (mode === "Point") document.getElementById("btn-draw-point").classList.add("active");
        if (mode === "LineString") document.getElementById("btn-draw-line").classList.add("active");
        if (mode === "Polygon") document.getElementById("btn-draw-polygon").classList.add("active");
    }

    updateFloatingDrawBar();
    refreshSketchLayer();
}

// İki doğru parçasının (AB ve CD) kesişip kesişmediğini kontrol eder (Topolojik Doğrulama)
function segmentsIntersect(a, b, c, d) {
    const ccw = (p1, p2, p3) => (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
    return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

// Poligon kenarlarının kendi kendini kesip kesmediğini (Self-Intersection / Kelebek Poligon) kontrol eder
function hasPolygonSelfIntersection(ringCoords) {
    // ringCoords kapalı halka: [p0, p1, ..., pn, p0]
    const n = ringCoords.length - 1;
    if (n < 3) return true;

    for (let i = 0; i < n; i++) {
        const a1 = ringCoords[i];
        const a2 = ringCoords[i + 1];
        for (let j = i + 2; j < n; j++) {
            // Komşu kenarlar ortak köşe paylaştığı için atla (ilk ve son kenar dahil)
            if (i === 0 && j === n - 1) continue;
            const b1 = ringCoords[j];
            const b2 = ringCoords[j + 1];
            if (segmentsIntersect(a1, a2, b1, b2)) {
                return true;
            }
        }
    }
    return false;
}

function stopDrawingMode() {
    const wasEditing = drawState.mode === "edit-geometry";
    drawState.mode = null;
    drawState.isAnalysisPolygon = false;
    drawState.isMeasureMode = false;
    drawState.coords = [];
    drawState.cursorCoord = null;
    drawState.editingFeature = null;

    drawState.vertexMarkers.forEach(m => m.remove());
    drawState.vertexMarkers = [];

    map.doubleClickZoom.enable();
    map.getCanvas().style.cursor = "";

    document.querySelectorAll(".draw-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("btn-draw-analysis-polygon")?.classList.remove("active");
    document.getElementById("btn-measure-line")?.classList.remove("active");
    document.getElementById("btn-measure-polygon")?.classList.remove("active");
    document.getElementById("floating-draw-bar").style.display = "none";
    refreshSketchLayer();

    // Geometri düzenlemeden çıkıldıysa gizlenen orijinal kaydı tekrar göster
    if (wasEditing && cachedDrawingsData && map.getSource("drawings-source")) {
        map.getSource("drawings-source").setData(cachedDrawingsData);
    }
}

function updateFloatingDrawBar() {
    const bar = document.getElementById("floating-draw-bar");
    const textEl = document.getElementById("floating-draw-text");
    const undoBtn = document.getElementById("btn-floating-undo");
    const finishBtn = document.getElementById("btn-floating-finish");

    if (!drawState.mode) {
        bar.style.display = "none";
        return;
    }

    bar.style.display = "flex";
    const count = drawState.coords.length;

    if (drawState.mode === "Point") {
        textEl.innerText = "Haritada nokta eklemek istediğiniz yere tıklayın";
        undoBtn.style.display = "none";
        finishBtn.style.display = "none";
    } else if (drawState.mode === "LineString") {
        textEl.innerText = drawState.isMeasureMode
            ? `Mesafe ölçümü için noktalara tıklayın (${count} nokta)`
            : `Çizgi için haritaya tıklayın (${count} nokta)`;
        undoBtn.style.display = count > 0 ? "inline-block" : "none";
        finishBtn.style.display = count >= 2 ? "inline-block" : "none";
        finishBtn.innerText = drawState.isMeasureMode ? "✔ Mesafeyi Hesapla" : "✔ Tamamla";
    } else if (drawState.mode === "Polygon") {
        textEl.innerText = drawState.isMeasureMode
            ? `Alan ölçümü için köşelere tıklayın (${count} köşe)`
            : drawState.isAnalysisPolygon
                ? `Analiz alanı için köşelere tıklayın (${count} köşe)`
                : `Alan için köşelere sırayla tıklayın (${count} köşe)`;
        undoBtn.style.display = count > 0 ? "inline-block" : "none";
        finishBtn.style.display = count >= 3 ? "inline-block" : "none";
        finishBtn.innerText = drawState.isMeasureMode
            ? "✔ Alanı Hesapla"
            : drawState.isAnalysisPolygon
                ? "✔ Alanı Analiz Et"
                : "✔ Tamamla";
    } else if (drawState.mode === "edit-geometry") {
        textEl.innerText = "Beyaz köşe noktalarını sürükleyip kaydedin";
        undoBtn.style.display = "none";
        finishBtn.style.display = "inline-block";
        finishBtn.innerText = "✔ Kaydet";
    }
}

function handleMapClickInDrawMode(e) {
    if (drawState.mode === "edit-geometry") return;

    const clickedCoord = [Number(e.lngLat.lng.toFixed(6)), Number(e.lngLat.lat.toFixed(6))];

    if (drawState.mode === "Point") {
        drawState.pendingGeometry = { type: "Point", coordinates: clickedCoord };
        stopDrawingMode();
        openDrawingModalForCreate(drawState.pendingGeometry);
        return;
    }

    // Çift tıklama veya aynı noktaya üst üste tıklama nedeniyle mükerrer köşe oluşmasını engelle
    const last = drawState.coords[drawState.coords.length - 1];
    if (last && Math.abs(last[0] - clickedCoord[0]) < 1e-5 && Math.abs(last[1] - clickedCoord[1]) < 1e-5) {
        return;
    }

    drawState.coords.push(clickedCoord);
    updateFloatingDrawBar();
    refreshSketchLayer();
}

map.on("dblclick", (e) => {
    if (drawState.mode === "LineString" && drawState.coords.length >= 2) {
        e.preventDefault();
        finishCurrentDrawing();
    } else if (drawState.mode === "Polygon" && drawState.coords.length >= 3) {
        e.preventDefault();
        finishCurrentDrawing();
    }
});

function finishCurrentDrawing() {
    if (drawState.mode === "edit-geometry") {
        saveEditedGeometry();
        return;
    }

    if (drawState.mode === "LineString" && drawState.coords.length >= 2) {
        const lineGeom = { type: "LineString", coordinates: [...drawState.coords] };
        const wasMeasure = drawState.isMeasureMode;
        stopDrawingMode();
        if (wasMeasure) {
            runCustomMeasureAnalysis(lineGeom, "Ölçülen Mesafe Hattı");
        } else {
            drawState.pendingGeometry = lineGeom;
            openDrawingModalForCreate(drawState.pendingGeometry);
        }
    } else if (drawState.mode === "Polygon" && drawState.coords.length >= 3) {
        const ring = [...drawState.coords, drawState.coords[0]];
        if (hasPolygonSelfIntersection(ring)) {
            alert("Geçersiz Poligon! Poligon kenarları birbirini kesemez (kelebek/çapraz şekil oluşamaz). Lütfen 'Geri Al' ile kesişen noktayı düzeltin.");
            return;
        }
        const polyGeom = { type: "Polygon", coordinates: [ring] };
        const wasAnalysis = drawState.isAnalysisPolygon;
        const wasMeasure = drawState.isMeasureMode;
        stopDrawingMode();

        if (wasMeasure) {
            runCustomMeasureAnalysis(polyGeom, "Ölçülen Alan");
        } else if (wasAnalysis) {
            runCustomPolygonAnalysis(polyGeom);
        } else {
            drawState.pendingGeometry = polyGeom;
            openDrawingModalForCreate(drawState.pendingGeometry);
        }
    }
}

document.getElementById("btn-draw-point").addEventListener("click", () => startDrawingMode("Point"));
document.getElementById("btn-draw-line").addEventListener("click", () => startDrawingMode("LineString"));
document.getElementById("btn-draw-polygon").addEventListener("click", () => startDrawingMode("Polygon"));

document.getElementById("btn-floating-undo").addEventListener("click", () => {
    if (drawState.coords.length > 0) {
        drawState.coords.pop();
        updateFloatingDrawBar();
        refreshSketchLayer();
    }
});
document.getElementById("btn-floating-finish").addEventListener("click", finishCurrentDrawing);
document.getElementById("btn-floating-cancel").addEventListener("click", stopDrawingMode);

// Şekil Taşıma / Köşe Düzenleme
function startGeometryEditMode(feature) {
    stopDrawingMode();
    if (activePopup) activePopup.remove();

    const cloned = JSON.parse(JSON.stringify(feature));
    drawState.mode = "edit-geometry";
    drawState.editingFeature = cloned;

    // Düzenleme sırasında alttaki eski şekli gizle ki üst üste binip kafa karıştırmasın
    if (cachedDrawingsData && map.getSource("drawings-source")) {
        const filtered = {
            type: "FeatureCollection",
            features: cachedDrawingsData.features.filter(
                f => String(f.properties.id) !== String(feature.properties.id)
            )
        };
        map.getSource("drawings-source").setData(filtered);
    }

    const geom = cloned.geometry;
    zoomToFeatureGeometry(geom);

    if (geom.type === "Point") {
        drawState.vertexMarkers.push(
            createVertexMarker(geom.coordinates, (ll) => {
                geom.coordinates = [ll.lng, ll.lat];
                refreshSketchLayer();
            })
        );
    } else if (geom.type === "LineString") {
        geom.coordinates.forEach((c, idx) => {
            drawState.vertexMarkers.push(
                createVertexMarker(c, (ll) => {
                    geom.coordinates[idx] = [ll.lng, ll.lat];
                    refreshSketchLayer();
                })
            );
        });
    } else if (geom.type === "Polygon") {
        const ring = geom.coordinates[0];
        for (let i = 0; i < ring.length - 1; i++) {
            drawState.vertexMarkers.push(
                createVertexMarker(ring[i], (ll) => {
                    ring[i] = [ll.lng, ll.lat];
                    if (i === 0) ring[ring.length - 1] = [ll.lng, ll.lat];
                    refreshSketchLayer();
                })
            );
        }
    }

    updateFloatingDrawBar();
    refreshSketchLayer();
}

function createVertexMarker(lngLatArr, onDrag) {
    const el = document.createElement("div");
    el.style.width = "14px";
    el.style.height = "14px";
    el.style.borderRadius = "50%";
    el.style.background = "#ffffff";
    el.style.border = "3px solid #059669";
    el.style.cursor = "grab";

    const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(lngLatArr)
        .addTo(map);
    marker.on("drag", () => onDrag(marker.getLngLat()));
    return marker;
}

async function saveEditedGeometry() {
    if (!drawState.editingFeature) return;
    const id = drawState.editingFeature.properties.id;
    const newGeom = drawState.editingFeature.geometry;

    if (newGeom.type === "Polygon" && hasPolygonSelfIntersection(newGeom.coordinates[0])) {
        alert("Geçersiz Poligon! Köşeleri taşırken kenarlar birbirini kesti. Lütfen kenarların kesişmediği geçerli bir şekil oluşturun.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/userdrawings/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                geometry: { type: newGeom.type, coordinates: newGeom.coordinates }
            })
        });
        if (!res.ok) throw new Error("Geometri güncellenemedi.");

        stopDrawingMode();
        await refreshUserDrawings();
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

// ----------------------------------------------------
// Kullanıcı Çizimleri Listesi ve CRUD
// ----------------------------------------------------
const drawingModal = document.getElementById("drawing-modal");

function openDrawingModalForCreate(geometry) {
    document.getElementById("drawing-id").value = "";
    document.getElementById("drawing-modal-title").innerText = "Yeni Çizimi Kaydet";
    document.getElementById("drawing-type-badge").innerText = `Tür: ${formatGeometryTypeTR(geometry.type)}`;
    document.getElementById("drawing-name").value = "";
    document.getElementById("drawing-desc").value = "";
    drawingModal.style.display = "flex";
    setTimeout(() => document.getElementById("drawing-name").focus(), 50);
}

function openDrawingModalForEdit(feature) {
    const props = feature.properties;
    drawState.pendingGeometry = null;
    document.getElementById("drawing-id").value = props.id;
    document.getElementById("drawing-modal-title").innerText = "Çizim Bilgilerini Düzenle";
    document.getElementById("drawing-type-badge").innerText =
        `Tür: ${formatGeometryTypeTR(props.geometryType || feature.geometry?.type)}`;
    document.getElementById("drawing-name").value = props.name || "";
    document.getElementById("drawing-desc").value = props.description || "";
    drawingModal.style.display = "flex";
    setTimeout(() => document.getElementById("drawing-name").focus(), 50);
}

function closeDrawingModal() {
    drawingModal.style.display = "none";
    drawState.pendingGeometry = null;
}

document.getElementById("drawing-modal-close-btn").addEventListener("click", closeDrawingModal);
document.getElementById("btn-cancel-drawing").addEventListener("click", closeDrawingModal);

document.getElementById("btn-save-drawing").addEventListener("click", async () => {
    const id = document.getElementById("drawing-id").value;
    const name = document.getElementById("drawing-name").value.trim();
    const description = document.getElementById("drawing-desc").value.trim();

    if (!name || name.length < 2) {
        alert("Lütfen çizim için bir ad giriniz!");
        return;
    }

    try {
        if (!id) {
            const res = await fetch(`${API_BASE_URL}/userdrawings`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    description: description || null,
                    geometry: {
                        type: drawState.pendingGeometry.type,
                        coordinates: drawState.pendingGeometry.coordinates
                    }
                })
            });
            if (!res.ok) throw new Error("Çizim kaydedilemedi.");
        } else {
            const res = await fetch(`${API_BASE_URL}/userdrawings/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, description: description || "" })
            });
            if (!res.ok) throw new Error("Çizim güncellenemedi.");
        }

        closeDrawingModal();
        await refreshUserDrawings();
    } catch (err) {
        alert("Hata: " + err.message);
    }
});

async function deleteUserDrawingById(id, name = "Bu çizim") {
    if (!confirm(`"${name}" kaydını silmek istediğinize emin misiniz?`)) return;
    try {
        const res = await fetch(`${API_BASE_URL}/userdrawings/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Silinemedi.");
        if (activePopup) activePopup.remove();
        await refreshUserDrawings();
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

function zoomToFeatureGeometry(geometry) {
    if (!geometry) return null;
    if (geometry.type === "Point") {
        map.flyTo({ center: geometry.coordinates, zoom: 15, speed: 1.2 });
        return geometry.coordinates;
    }
    const bounds = new maplibregl.LngLatBounds();
    const extend = (coords) => {
        if (typeof coords[0] === "number") bounds.extend(coords);
        else coords.forEach(extend);
    };
    extend(geometry.coordinates);
    map.fitBounds(bounds, { padding: 80, maxZoom: 15, speed: 1.2 });
    return bounds.getCenter();
}

let currentDrawingTypeFilter = "all"; // "all" | "point" | "line" | "polygon"

function getDrawingTypeKey(f) {
    const raw = (f?.properties?.geometryType || f?.geometry?.type || "").toLowerCase();
    if (raw.includes("polygon")) return "polygon";
    if (raw.includes("line")) return "line";
    return "point";
}

function zoomToMultipleFeatures(features) {
    if (!features || features.length === 0) return;
    if (features.length === 1) {
        zoomToFeatureGeometry(features[0].geometry);
        return;
    }
    const bounds = new maplibregl.LngLatBounds();
    const extend = (coords) => {
        if (!coords) return;
        if (typeof coords[0] === "number") bounds.extend(coords);
        else coords.forEach(extend);
    };
    features.forEach(f => {
        if (f?.geometry?.coordinates) extend(f.geometry.coordinates);
    });
    if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, speed: 1.2 });
    }
}

function applyDrawingsMapFilter(filterKey, shouldZoom = false) {
    const allFeatures = cachedDrawingsData?.features || [];
    const filteredFeatures = filterKey === "all"
        ? allFeatures
        : allFeatures.filter(f => getDrawingTypeKey(f) === filterKey);

    if (map.getSource("drawings-source")) {
        map.getSource("drawings-source").setData({
            type: "FeatureCollection",
            features: filteredFeatures
        });
    }

    if (shouldZoom && filteredFeatures.length > 0) {
        zoomToMultipleFeatures(filteredFeatures);
    }
}

document.querySelectorAll(".draw-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".draw-filter-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentDrawingTypeFilter = btn.getAttribute("data-dtype") || "all";
        renderDrawingsList();
        applyDrawingsMapFilter(currentDrawingTypeFilter, true);
    });
});

function createDrawingCardElement(f) {
    const props = f.properties;
    const typeKey = getDrawingTypeKey(f);
    const typeStr = formatGeometryTypeTR(props.geometryType || f.geometry?.type);

    const iconClass = typeKey === "polygon"
        ? "fa-draw-polygon"
        : typeKey === "line"
            ? "fa-route"
            : "fa-location-dot";

    const card = document.createElement("div");
    card.className = "list-card";
    card.innerHTML = `
        <span class="draw-type-icon ${typeKey}">
            <i class="fa-solid ${iconClass}"></i>
        </span>
        <div class="list-card-info">
            <div class="list-card-title">${props.name || "İsimsiz Çizim"}</div>
            <div class="list-card-sub">${typeStr}${props.description ? " • " + props.description : ""}</div>
        </div>
        <div class="list-card-actions">
            <button class="icon-btn edit" title="Ad/Açıklama Düzenle"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn move" title="Haritada Taşı"><i class="fa-solid fa-up-down-left-right"></i></button>
            <button class="icon-btn delete" title="Sil"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;

    card.addEventListener("click", (e) => {
        if (e.target.closest(".icon-btn")) return;
        const center = zoomToFeatureGeometry(f.geometry);
        if (center) showDrawingPopup(f, center);
    });

    card.querySelector(".icon-btn.edit").addEventListener("click", (e) => {
        e.stopPropagation();
        openDrawingModalForEdit(f);
    });
    card.querySelector(".icon-btn.move").addEventListener("click", (e) => {
        e.stopPropagation();
        startGeometryEditMode(f);
    });
    card.querySelector(".icon-btn.delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteUserDrawingById(props.id, props.name);
    });

    return card;
}

function renderDrawingsList() {
    const listEl = document.getElementById("drawings-list");
    const countEl = document.getElementById("drawings-count");
    const features = cachedDrawingsData?.features || [];

    if (countEl) countEl.innerText = features.length;
    if (!listEl) return;
    listEl.innerHTML = "";

    const points = features.filter(f => getDrawingTypeKey(f) === "point");
    const lines = features.filter(f => getDrawingTypeKey(f) === "line");
    const polygons = features.filter(f => getDrawingTypeKey(f) === "polygon");

    // Filtre butonlarının üzerindeki sayıları güncelle
    const btnAll = document.querySelector('.draw-filter-btn[data-dtype="all"]');
    const btnPoint = document.querySelector('.draw-filter-btn[data-dtype="point"]');
    const btnLine = document.querySelector('.draw-filter-btn[data-dtype="line"]');
    const btnPoly = document.querySelector('.draw-filter-btn[data-dtype="polygon"]');
    if (btnAll) btnAll.innerHTML = `Tümü (${features.length})`;
    if (btnPoint) btnPoint.innerHTML = `<i class="fa-solid fa-location-dot"></i> Nokta (${points.length})`;
    if (btnLine) btnLine.innerHTML = `<i class="fa-solid fa-route"></i> Çizgi (${lines.length})`;
    if (btnPoly) btnPoly.innerHTML = `<i class="fa-solid fa-draw-polygon"></i> Alan (${polygons.length})`;

    if (features.length === 0) {
        listEl.innerHTML = `<div style="padding: 16px; font-size: 0.8rem; color: #94a3b8; text-align: center;">Henüz çizim eklenmedi.<br/>Yukarıdaki butonlarla haritaya nokta, çizgi veya alan çizebilirsiniz.</div>`;
        return;
    }

    const groups = [
        { key: "point", title: "Noktalar", icon: "fa-location-dot", items: points },
        { key: "line", title: "Çizgiler (Güzergâhlar)", icon: "fa-route", items: lines },
        { key: "polygon", title: "Alanlar (Poligonlar)", icon: "fa-draw-polygon", items: polygons }
    ];

    const visibleGroups = currentDrawingTypeFilter === "all"
        ? groups.filter(g => g.items.length > 0)
        : groups.filter(g => g.key === currentDrawingTypeFilter);

    if (visibleGroups.length === 0 || visibleGroups.every(g => g.items.length === 0)) {
        listEl.innerHTML = `<div style="padding: 16px; font-size: 0.8rem; color: #94a3b8; text-align: center;">Bu türde kayıtlı çizim bulunmuyor.</div>`;
        return;
    }

    visibleGroups.forEach(group => {
        if (group.items.length === 0) return;

        const header = document.createElement("div");
        header.className = "draw-group-header";
        header.innerHTML = `
            <span><i class="fa-solid ${group.icon}"></i> ${group.title} (${group.items.length})</span>
            <button class="draw-group-zoom-btn" title="Bu gruptaki tüm objeleri harita ekranına sığdır (Zoom to Layer)">
                <i class="fa-solid fa-compress"></i> Tümünü Sığdır
            </button>
        `;
        header.querySelector(".draw-group-zoom-btn").addEventListener("click", () => {
            zoomToMultipleFeatures(group.items);
        });
        listEl.appendChild(header);

        group.items.forEach(f => {
            listEl.appendChild(createDrawingCardElement(f));
        });
    });
}

// ----------------------------------------------------
// Hastane Düzenleme Modalı
// ----------------------------------------------------
const modal = document.getElementById("edit-modal");

function openHospitalEditModal(props) {
    selectedHospital = props;
    const editDistrictSelect = document.getElementById("edit-district");
    editDistrictSelect.innerHTML = "";
    if (cachedDistrictsData) {
        const uniqueNames = [...new Set(cachedDistrictsData.features.map(d => d.properties.name))].sort();
        uniqueNames.forEach(name => {
            if (name) {
                const opt = document.createElement("option");
                opt.value = name;
                opt.textContent = name;
                if (name.toLowerCase() === (props.district || "").toLowerCase()) opt.selected = true;
                editDistrictSelect.appendChild(opt);
            }
        });
    }

    document.getElementById("edit-id").value = props.id;
    document.getElementById("edit-name").value = props.name || "";
    document.getElementById("edit-street").value = props.street || "";
    document.getElementById("edit-phone").value = props.phone || "";
    document.getElementById("edit-website").value = props.website || "";
    document.getElementById("edit-emergency").checked = props.emergency === "yes";
    modal.style.display = "flex";
}

document.getElementById("modal-close-btn").addEventListener("click", () => (modal.style.display = "none"));
document.getElementById("btn-cancel-edit").addEventListener("click", () => (modal.style.display = "none"));

document.getElementById("btn-save-edit").addEventListener("click", async () => {
    const id = document.getElementById("edit-id").value;
    const name = document.getElementById("edit-name").value.trim();
    const district = document.getElementById("edit-district").value;
    const street = document.getElementById("edit-street").value.trim();
    const phone = document.getElementById("edit-phone").value.trim();
    const website = document.getElementById("edit-website").value.trim();
    const emergency = document.getElementById("edit-emergency").checked ? "yes" : "no";

    if (!name || name.length < 3) {
        alert("Lütfen geçerli bir hastane adı giriniz!");
        return;
    }

    const updateData = {
        name,
        district,
        street: street || null,
        phone: phone || null,
        website: website ? (website.startsWith("http") ? website : `https://${website}`) : null,
        emergency
    };

    try {
        const res = await fetch(`${API_BASE_URL}/hospitals/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updateData)
        });
        if (!res.ok) throw new Error("Güncelleme başarısız.");

        modal.style.display = "none";
        if (selectedHospital) {
            Object.assign(selectedHospital, updateData);
            if (selectedHospital._coordinates) {
                showHospitalPopup(selectedHospital, selectedHospital._coordinates);
            }
        }
        await filterHospitals();
    } catch (err) {
        alert("Hata: " + err.message);
    }
});

// ----------------------------------------------------
// Geometrik Analiz Modülü (Madde 4)
// ----------------------------------------------------
const btnStartNearest = document.getElementById("btn-start-nearest");
const btnClearAnalysis = document.getElementById("btn-clear-analysis");
const nearestCountInput = document.getElementById("nearest-count-input");
const polygonSelectSource = document.getElementById("polygon-select-source");
const btnDrawAnalysisPolygon = document.getElementById("btn-draw-analysis-polygon");
const btnStartBuffer = document.getElementById("btn-start-buffer");
const bufferRadiusInput = document.getElementById("buffer-radius-input");
const bufferSelectDrawing = document.getElementById("buffer-select-drawing");
const measureSelectSource = document.getElementById("measure-select-source");
const btnMeasureLine = document.getElementById("btn-measure-line");
const btnMeasurePolygon = document.getElementById("btn-measure-polygon");
const btnRunChoropleth = document.getElementById("btn-run-choropleth");

function clearChoroplethLayer() {
    const emptyFc = { type: "FeatureCollection", features: [] };
    analysisState.choroplethGeoJson = null;
    if (map.getSource("analysis-choropleth-source")) {
        map.getSource("analysis-choropleth-source").setData(emptyFc);
    }
}

// Analiz Alt Sekme Geçişleri
document.querySelectorAll(".analysis-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        stopNearestPickMode();
        stopDrawingMode();

        document.querySelectorAll(".analysis-mode-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const targetPanel = btn.getAttribute("data-panel");
        document.getElementById("panel-nearest").style.display = targetPanel === "panel-nearest" ? "flex" : "none";
        document.getElementById("panel-polygon").style.display = targetPanel === "panel-polygon" ? "flex" : "none";
        document.getElementById("panel-buffer").style.display = targetPanel === "panel-buffer" ? "flex" : "none";
        const panelMeasure = document.getElementById("panel-measure");
        if (panelMeasure) panelMeasure.style.display = targetPanel === "panel-measure" ? "flex" : "none";
        const panelChoropleth = document.getElementById("panel-choropleth");
        if (panelChoropleth) panelChoropleth.style.display = targetPanel === "panel-choropleth" ? "flex" : "none";

        if (targetPanel === "panel-choropleth") {
            runChoroplethAnalysis();
        }
    });
});

// İlçe ve Kayıtlı Çizimleri Seçim Listelerine Doldur
function populateAnalysisPolygonSelector() {
    const sortedDistricts = [...(cachedDistrictsData?.features || [])].sort((a, b) =>
        (a.properties.name || "").localeCompare(b.properties.name || "", "tr")
    );

    if (polygonSelectSource) {
        const prevValue = polygonSelectSource.value;
        polygonSelectSource.innerHTML = `<option value="">İlçe veya Kayıtlı Alan Seçin...</option>`;

        if (sortedDistricts.length) {
            const distGroup = document.createElement("optgroup");
            distGroup.label = "İlçeler";

            sortedDistricts.forEach(d => {
                const opt = document.createElement("option");
                opt.value = `district:${d.properties.id}`;
                opt.textContent = d.properties.name;
                distGroup.appendChild(opt);
            });
            polygonSelectSource.appendChild(distGroup);
        }

        const polyDrawings = (cachedDrawingsData?.features || []).filter(f => {
            const gType = (f.geometry?.type || f.properties?.geometryType || "").toLowerCase();
            return gType.includes("polygon");
        });

        if (polyDrawings.length > 0) {
            const drawGroup = document.createElement("optgroup");
            drawGroup.label = "Kayıtlı Çizimlerim";

            polyDrawings.forEach(f => {
                const opt = document.createElement("option");
                opt.value = `drawing:${f.properties.id}`;
                opt.textContent = f.properties.name || "İsimsiz Alan";
                drawGroup.appendChild(opt);
            });
            polygonSelectSource.appendChild(drawGroup);
        }

        if (prevValue && [...polygonSelectSource.options].some(o => o.value === prevValue)) {
            polygonSelectSource.value = prevValue;
        }
    }

    // Tampon Bölge (Buffer) için Kayıtlı Çizimleri (Nokta, Çizgi ve Alan) Doldur
    if (bufferSelectDrawing) {
        const prevBuf = bufferSelectDrawing.value;
        bufferSelectDrawing.innerHTML = `<option value="">veya Kayıtlı Nokta / Çizgi / Alan Seçin...</option>`;

        const allDrawings = (cachedDrawingsData?.features || []).filter(f => {
            const gType = (f.geometry?.type || f.properties?.geometryType || "").toLowerCase();
            return gType.includes("point") || gType.includes("line") || gType.includes("polygon");
        });

        allDrawings.forEach(f => {
            const gType = (f.geometry?.type || f.properties?.geometryType || "").toLowerCase();
            const typeLabel = gType.includes("polygon")
                ? "Alan"
                : gType.includes("line")
                    ? "Çizgi"
                    : "Nokta";
            const opt = document.createElement("option");
            opt.value = `drawing:${f.properties.id}`;
            opt.textContent = `${f.properties.name || "Çizim"} (${typeLabel})`;
            bufferSelectDrawing.appendChild(opt);
        });

        if (prevBuf && [...bufferSelectDrawing.options].some(o => o.value === prevBuf)) {
            bufferSelectDrawing.value = prevBuf;
        }
    }

    // Metrik Ölçüm (Uzunluk / Alan) için Kayıtlı Çizgi/Alan ve İlçeleri Doldur
    if (measureSelectSource) {
        const prevMeas = measureSelectSource.value;
        measureSelectSource.innerHTML = `<option value="">Kayıtlı Çizim veya İlçe Seçin...</option>`;

        const measurableDrawings = (cachedDrawingsData?.features || []).filter(f => {
            const gType = (f.geometry?.type || f.properties?.geometryType || "").toLowerCase();
            return gType.includes("line") || gType.includes("polygon");
        });

        if (measurableDrawings.length > 0) {
            const drawGroup = document.createElement("optgroup");
            drawGroup.label = "Kayıtlı Çizimlerim (Çizgi / Alan)";

            measurableDrawings.forEach(f => {
                const gType = (f.geometry?.type || f.properties?.geometryType || "").toLowerCase();
                const typeLabel = gType.includes("line") ? "Çizgi" : "Alan";
                const opt = document.createElement("option");
                opt.value = `drawing:${f.properties.id}`;
                opt.textContent = `${f.properties.name || "Çizim"} (${typeLabel})`;
                drawGroup.appendChild(opt);
            });
            measureSelectSource.appendChild(drawGroup);
        }

        if (sortedDistricts.length > 0) {
            const distGroup = document.createElement("optgroup");
            distGroup.label = "İlçeler (Alan & Çevre)";

            sortedDistricts.forEach(d => {
                const opt = document.createElement("option");
                opt.value = `district:${d.properties.id}`;
                opt.textContent = d.properties.name;
                distGroup.appendChild(opt);
            });
            measureSelectSource.appendChild(distGroup);
        }

        if (prevMeas && [...measureSelectSource.options].some(o => o.value === prevMeas)) {
            measureSelectSource.value = prevMeas;
        }
    }
}

// --- ANALİZ 1: EN YAKIN N HASTANE ---
btnStartNearest.addEventListener("click", () => {
    stopDrawingMode();
    if (activePopup) activePopup.remove();

    analysisState.activeMode = "nearest";
    btnStartNearest.classList.add("active");
    btnStartNearest.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Haritaya Tıklayın...`;

    const bar = document.getElementById("floating-draw-bar");
    document.getElementById("floating-draw-text").innerText =
        "En yakın hastaneleri bulmak için harita üzerinde bir konuma tıklayın";
    document.getElementById("btn-floating-undo").style.display = "none";
    document.getElementById("btn-floating-finish").style.display = "none";
    bar.style.display = "flex";
});

document.getElementById("btn-floating-cancel").addEventListener("click", () => {
    if (analysisState.activeMode) {
        stopNearestPickMode();
    }
});

function stopNearestPickMode() {
    analysisState.activeMode = null;
    map.getCanvas().style.cursor = "";
    btnStartNearest.classList.remove("active");
    btnStartNearest.innerHTML = `<i class="fa-solid fa-location-crosshairs"></i> Konum Seç`;
    if (btnStartBuffer) {
        btnStartBuffer.classList.remove("active");
        btnStartBuffer.innerHTML = `<i class="fa-solid fa-bullseye"></i> Nokta / Obje Seç`;
    }
    document.getElementById("floating-draw-bar").style.display = "none";
}

nearestCountInput.addEventListener("change", () => {
    if (analysisState.lastOrigin && analysisState.lastType === "nearest") {
        runNearestHospitalsAnalysis(analysisState.lastOrigin.lat, analysisState.lastOrigin.lng);
    }
});

async function runNearestHospitalsAnalysis(lat, lng) {
    stopNearestPickMode();
    clearChoroplethLayer();

    let count = parseInt(nearestCountInput.value, 10);
    if (isNaN(count) || count < 1) count = 3;
    if (count > 20) count = 20;
    nearestCountInput.value = count;

    const emptyFc = { type: "FeatureCollection", features: [] };
    analysisState.polygonGeoJson = emptyFc;
    if (map.getSource("analysis-polygon-source")) {
        map.getSource("analysis-polygon-source").setData(emptyFc);
    }
    if (polygonSelectSource) polygonSelectSource.value = "";
    if (bufferSelectDrawing) bufferSelectDrawing.value = "";
    if (measureSelectSource) measureSelectSource.value = "";

    analysisState.lastOrigin = { lat, lng };
    analysisState.lastType = "nearest";

    try {
        const url = `${API_BASE_URL}/analysis/nearest-hospitals?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&count=${count}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Analiz sorgusu başarısız oldu.");

        const data = await res.json();
        analysisState.linesGeoJson = data.linesGeoJson;
        analysisState.hospitalsGeoJson = data.hospitalsGeoJson;

        placeOriginMarker(lng, lat);

        if (map.getSource("analysis-lines-source")) {
            map.getSource("analysis-lines-source").setData(data.linesGeoJson);
        } else {
            ensureAllLayersAdded();
        }

        if (map.getSource("analysis-points-source")) {
            map.getSource("analysis-points-source").setData(data.hospitalsGeoJson);
        } else {
            ensureAllLayersAdded();
        }

        const bounds = new maplibregl.LngLatBounds();
        bounds.extend([lng, lat]);
        data.hospitalsGeoJson.features.forEach(f => bounds.extend(f.geometry.coordinates));
        map.fitBounds(bounds, { padding: 80, maxZoom: 14, speed: 1.2 });

        renderNearestAnalysisList(data.hospitalsGeoJson.features, `En Yakın ${data.hospitalsGeoJson.features.length} Hastane`);
        btnClearAnalysis.style.display = "inline-block";
    } catch (err) {
        alert("Analiz hatası: " + err.message);
    }
}

function placeOriginMarker(lng, lat) {
    if (analysisState.originMarker) {
        analysisState.originMarker.remove();
    }
    const markerEl = document.createElement("div");
    markerEl.style.width = "16px";
    markerEl.style.height = "16px";
    markerEl.style.borderRadius = "50%";
    markerEl.style.background = "#2563eb";
    markerEl.style.border = "3px solid #ffffff";
    markerEl.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.3)";

    analysisState.originMarker = new maplibregl.Marker({ element: markerEl })
        .setLngLat([lng, lat])
        .setPopup(
            new maplibregl.Popup({ offset: 10 }).setHTML(`
                <div class="popup-title">Seçilen Konum</div>
                <div class="popup-info">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
            `)
        )
        .addTo(map);
}

function renderNearestAnalysisList(features, headerTitle) {
    const headerEl = document.getElementById("analysis-results-header");
    const listEl = document.getElementById("analysis-results-list");
    headerEl.innerText = headerTitle;
    listEl.innerHTML = "";

    features.forEach((f) => {
        const props = f.properties;
        const coords = f.geometry.coordinates.slice();
        props._coordinates = coords;

        const card = document.createElement("div");
        card.className = "list-card";
        card.innerHTML = `
            <span class="rank-badge">${props.rank}</span>
            <div class="list-card-info">
                <div class="list-card-title">${props.name}</div>
                <div class="list-card-sub">
                    ${props.district || "Bursa"} ${props.emergency === "yes" ? "• Acil Servis" : ""}
                </div>
            </div>
            <span class="distance-badge">${props.distanceFormatted}</span>
        `;

        card.addEventListener("click", () => {
            map.flyTo({ center: coords, zoom: 15, speed: 1.2 });
            showHospitalPopup(props, coords);
        });

        listEl.appendChild(card);
    });
}

// --- ANALİZ 2: ALAN SORGUSU ---
polygonSelectSource.addEventListener("change", async () => {
    const val = polygonSelectSource.value;
    if (!val) return;

    stopNearestPickMode();
    stopDrawingMode();
    if (bufferSelectDrawing) bufferSelectDrawing.value = "";
    if (measureSelectSource) measureSelectSource.value = "";

    const [sourceType, id] = val.split(":");
    try {
        const endpoint = sourceType === "district"
            ? `${API_BASE_URL}/analysis/in-polygon/district/${id}`
            : `${API_BASE_URL}/analysis/in-polygon/drawing/${id}`;

        const res = await fetch(endpoint);
        if (!res.ok) throw new Error("Alan sorgusu başarısız oldu.");

        const data = await res.json();
        displayPolygonAnalysisResult(data);
    } catch (err) {
        alert("Hata: " + err.message);
    }
});

btnDrawAnalysisPolygon.addEventListener("click", () => {
    stopNearestPickMode();
    if (polygonSelectSource) polygonSelectSource.value = "";
    if (bufferSelectDrawing) bufferSelectDrawing.value = "";
    if (measureSelectSource) measureSelectSource.value = "";
    startDrawingMode("Polygon", true);
});

async function runCustomPolygonAnalysis(polyGeometry) {
    try {
        const res = await fetch(`${API_BASE_URL}/analysis/in-polygon/custom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "Seçili Alan",
                geometry: {
                    type: polyGeometry.type,
                    coordinates: polyGeometry.coordinates
                }
            })
        });

        if (!res.ok) {
            const errMsg = await res.text();
            throw new Error(errMsg || "Alan analizi başarısız oldu.");
        }

        const data = await res.json();
        displayPolygonAnalysisResult(data);
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

function displayPolygonAnalysisResult(data) {
    clearChoroplethLayer();
    analysisState.lastOrigin = null;
    analysisState.lastType = "polygon";
    if (analysisState.originMarker) {
        analysisState.originMarker.remove();
        analysisState.originMarker = null;
    }
    const emptyFc = { type: "FeatureCollection", features: [] };
    analysisState.linesGeoJson = emptyFc;
    if (map.getSource("analysis-lines-source")) {
        map.getSource("analysis-lines-source").setData(emptyFc);
    }

    analysisState.polygonGeoJson = data.polygonGeoJson;
    analysisState.hospitalsGeoJson = data.hospitalsGeoJson;

    if (map.getSource("analysis-polygon-source")) {
        map.getSource("analysis-polygon-source").setData(data.polygonGeoJson);
    } else {
        ensureAllLayersAdded();
    }

    if (map.getSource("analysis-points-source")) {
        map.getSource("analysis-points-source").setData(data.hospitalsGeoJson);
    } else {
        ensureAllLayersAdded();
    }

    const polyGeom = data.polygonGeoJson?.features?.[0]?.geometry;
    if (polyGeom) {
        zoomToFeatureGeometry(polyGeom);
    }

    const headerEl = document.getElementById("analysis-results-header");
    const listEl = document.getElementById("analysis-results-list");
    headerEl.innerText = `${data.polygonName} (${data.areaFormatted}) • ${data.count} Hastane`;
    btnClearAnalysis.style.display = "inline-block";
    listEl.innerHTML = "";

    const features = data.hospitalsGeoJson?.features || [];
    if (features.length === 0) {
        listEl.innerHTML = `
            <div class="empty-hint">
                Bu alan (${data.areaFormatted}) içinde hastane bulunamadı.
            </div>
        `;
        return;
    }

    features.forEach((f) => {
        const props = f.properties;
        const coords = f.geometry.coordinates.slice();
        props._coordinates = coords;

        const card = document.createElement("div");
        card.className = "list-card";
        card.innerHTML = `
            <span class="rank-badge">${props.rank}</span>
            <div class="list-card-info">
                <div class="list-card-title">${props.name}</div>
                <div class="list-card-sub">
                    ${props.district || "Bursa"}${props.street ? " • " + props.street : ""}
                </div>
            </div>
            ${props.emergency === "yes" ? '<span class="distance-badge">Acil</span>' : ""}
        `;

        card.addEventListener("click", () => {
            map.flyTo({ center: coords, zoom: 15, speed: 1.2 });
            showHospitalPopup(props, coords);
        });

        listEl.appendChild(card);
    });
}

// --- ANALİZ 3: YAKINLIK / TAMPON BÖLGE (ST_Buffer & ST_DWithin) ---
function getBufferRadiusMeters() {
    let r = parseFloat(bufferRadiusInput?.value || "1000");
    if (isNaN(r) || r < 50) r = 50;
    if (r > 50000) r = 50000;
    if (bufferRadiusInput) bufferRadiusInput.value = Math.round(r);
    return r;
}

btnStartBuffer.addEventListener("click", () => {
    stopDrawingMode();
    if (activePopup) activePopup.remove();

    analysisState.activeMode = "buffer-point";
    btnStartBuffer.classList.add("active");
    btnStartBuffer.innerHTML = `<i class="fa-solid fa-crosshairs"></i> Haritaya Tıklayın...`;

    const bar = document.getElementById("floating-draw-bar");
    document.getElementById("floating-draw-text").innerText =
        `Tampon bölge (${getBufferRadiusMeters()} m) için haritada bir objeye (hastane/çizim) veya noktaya tıklayın`;
    document.getElementById("btn-floating-undo").style.display = "none";
    document.getElementById("btn-floating-finish").style.display = "none";
    bar.style.display = "flex";
});

bufferRadiusInput.addEventListener("change", () => {
    if (analysisState.lastType === "buffer-point" && analysisState.lastOrigin) {
        runPointBufferAnalysis(analysisState.lastOrigin.lat, analysisState.lastOrigin.lng);
    } else if (analysisState.lastType === "buffer-drawing" && bufferSelectDrawing.value) {
        runDrawingBufferAnalysis(bufferSelectDrawing.value);
    }
});

bufferSelectDrawing.addEventListener("change", () => {
    const selectedTarget = bufferSelectDrawing.value;
    if (!selectedTarget) return;
    stopNearestPickMode();
    stopDrawingMode();
    if (measureSelectSource) measureSelectSource.value = "";
    runDrawingBufferAnalysis(selectedTarget);
});

async function runPointBufferAnalysis(lat, lng) {
    stopNearestPickMode();
    if (polygonSelectSource) polygonSelectSource.value = "";
    if (bufferSelectDrawing) bufferSelectDrawing.value = "";
    if (measureSelectSource) measureSelectSource.value = "";

    const radius = getBufferRadiusMeters();
    analysisState.lastOrigin = { lat, lng };
    analysisState.lastType = "buffer-point";

    try {
        const url = `${API_BASE_URL}/analysis/buffer/point?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&radiusMeters=${radius}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Tampon bölge analizi başarısız oldu.");

        const data = await res.json();
        placeOriginMarker(lng, lat);
        displayBufferAnalysisResult(data);
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

async function runDrawingBufferAnalysis(targetValue) {
    if (polygonSelectSource) polygonSelectSource.value = "";
    if (measureSelectSource) measureSelectSource.value = "";
    if (analysisState.originMarker) {
        analysisState.originMarker.remove();
        analysisState.originMarker = null;
    }

    const radius = getBufferRadiusMeters();
    analysisState.lastOrigin = null;
    analysisState.lastType = "buffer-drawing";

    const parts = String(targetValue).split(":");
    const targetType = parts.length === 2 ? parts[0] : "drawing";
    const targetId = parts.length === 2 ? parts[1] : parts[0];

    try {
        const url = targetType === "hospital"
            ? `${API_BASE_URL}/analysis/buffer/hospital/${targetId}?radiusMeters=${radius}`
            : `${API_BASE_URL}/analysis/buffer/drawing/${targetId}?radiusMeters=${radius}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error("Seçilen obje için tampon analizi başarısız oldu.");

        const data = await res.json();
        displayBufferAnalysisResult(data);
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

function displayBufferAnalysisResult(data) {
    clearChoroplethLayer();
    const emptyFc = { type: "FeatureCollection", features: [] };
    analysisState.linesGeoJson = emptyFc;
    if (map.getSource("analysis-lines-source")) {
        map.getSource("analysis-lines-source").setData(emptyFc);
    }

    analysisState.polygonGeoJson = data.polygonGeoJson;
    analysisState.hospitalsGeoJson = data.hospitalsGeoJson;

    if (map.getSource("analysis-polygon-source")) {
        map.getSource("analysis-polygon-source").setData(data.polygonGeoJson);
    } else {
        ensureAllLayersAdded();
    }

    if (map.getSource("analysis-points-source")) {
        map.getSource("analysis-points-source").setData(data.hospitalsGeoJson);
    } else {
        ensureAllLayersAdded();
    }

    const bufGeom = data.polygonGeoJson?.features?.[0]?.geometry;
    if (bufGeom) {
        zoomToFeatureGeometry(bufGeom);
    }

    const title = `${data.sourceName} • ${data.count} Hastane`;
    btnClearAnalysis.style.display = "inline-block";

    const features = data.hospitalsGeoJson?.features || [];
    if (features.length === 0) {
        document.getElementById("analysis-results-header").innerText = title;
        document.getElementById("analysis-results-list").innerHTML = `
            <div class="empty-hint">
                ${Math.round(data.radiusMeters)} m mesafe içinde hastane bulunamadı.
            </div>
        `;
        return;
    }

    renderNearestAnalysisList(features, title);
}

// --- ANALİZ 4: METRİK ÖLÇÜM (EPSG:5254 TUREF / TM30) ---
if (measureSelectSource) {
    measureSelectSource.addEventListener("change", async () => {
        const val = measureSelectSource.value;
        if (!val) return;

        stopNearestPickMode();
        stopDrawingMode();
        if (polygonSelectSource) polygonSelectSource.value = "";
        if (bufferSelectDrawing) bufferSelectDrawing.value = "";

        const [sourceType, id] = val.split(":");
        try {
            const endpoint = sourceType === "district"
                ? `${API_BASE_URL}/analysis/measure/district/${id}`
                : `${API_BASE_URL}/analysis/measure/drawing/${id}`;

            const res = await fetch(endpoint);
            if (!res.ok) throw new Error("Ölçüm hesaplanamadı.");

            const data = await res.json();
            displayMeasurementResult(data);
        } catch (err) {
            alert("Hata: " + err.message);
        }
    });
}

if (btnMeasureLine) {
    btnMeasureLine.addEventListener("click", () => {
        stopNearestPickMode();
        if (measureSelectSource) measureSelectSource.value = "";
        startDrawingMode("LineString", false, true);
    });
}

if (btnMeasurePolygon) {
    btnMeasurePolygon.addEventListener("click", () => {
        stopNearestPickMode();
        if (measureSelectSource) measureSelectSource.value = "";
        startDrawingMode("Polygon", false, true);
    });
}

async function runCustomMeasureAnalysis(geometry, name = "Ölçülen Geometri") {
    try {
        const res = await fetch(`${API_BASE_URL}/analysis/measure/custom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name,
                geometry: {
                    type: geometry.type,
                    coordinates: geometry.coordinates
                }
            })
        });

        if (!res.ok) {
            const errMsg = await res.text();
            throw new Error(errMsg || "Ölçüm hesaplanamadı.");
        }

        const data = await res.json();
        displayMeasurementResult(data);
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

function displayMeasurementResult(data) {
    clearChoroplethLayer();
    analysisState.lastOrigin = null;
    analysisState.lastType = "measure";
    if (analysisState.originMarker) {
        analysisState.originMarker.remove();
        analysisState.originMarker = null;
    }

    const emptyFc = { type: "FeatureCollection", features: [] };
    analysisState.hospitalsGeoJson = emptyFc;
    if (map.getSource("analysis-points-source")) {
        map.getSource("analysis-points-source").setData(emptyFc);
    }

    const gType = (data.geometryType || "").toLowerCase();
    if (gType.includes("line")) {
        analysisState.linesGeoJson = data.featureGeoJson;
        analysisState.polygonGeoJson = emptyFc;
        if (map.getSource("analysis-lines-source")) {
            map.getSource("analysis-lines-source").setData(data.featureGeoJson);
        } else {
            ensureAllLayersAdded();
        }
        if (map.getSource("analysis-polygon-source")) {
            map.getSource("analysis-polygon-source").setData(emptyFc);
        }
    } else {
        analysisState.polygonGeoJson = data.featureGeoJson;
        analysisState.linesGeoJson = emptyFc;
        if (map.getSource("analysis-polygon-source")) {
            map.getSource("analysis-polygon-source").setData(data.featureGeoJson);
        } else {
            ensureAllLayersAdded();
        }
        if (map.getSource("analysis-lines-source")) {
            map.getSource("analysis-lines-source").setData(emptyFc);
        }
    }

    const featGeom = data.featureGeoJson?.features?.[0]?.geometry;
    if (featGeom) {
        zoomToFeatureGeometry(featGeom);
    }

    const headerEl = document.getElementById("analysis-results-header");
    const listEl = document.getElementById("analysis-results-list");
    headerEl.innerText = `${data.name} • Metrik Ölçüm`;
    btnClearAnalysis.style.display = "inline-block";

    const rows = [];
    if (data.lengthFormatted) {
        rows.push(`
            <div class="list-card" style="cursor: default;">
                <span class="rank-badge"><i class="fa-solid fa-ruler-horizontal"></i></span>
                <div class="list-card-info">
                    <div class="list-card-title">Toplam Uzunluk</div>
                    <div class="list-card-sub">${data.lengthMeters.toLocaleString("tr-TR")} m</div>
                </div>
                <span class="distance-badge">${data.lengthFormatted}</span>
            </div>
        `);
    }

    if (data.areaFormatted) {
        rows.push(`
            <div class="list-card" style="cursor: default;">
                <span class="rank-badge"><i class="fa-solid fa-vector-square"></i></span>
                <div class="list-card-info">
                    <div class="list-card-title">Yüzölçümü (Alan)</div>
                    <div class="list-card-sub">${data.areaSquareMeters.toLocaleString("tr-TR")} m² • ${data.areaHectares.toLocaleString("tr-TR")} ha</div>
                </div>
                <span class="distance-badge">${data.areaFormatted}</span>
            </div>
        `);
    }

    if (data.perimeterFormatted) {
        rows.push(`
            <div class="list-card" style="cursor: default;">
                <span class="rank-badge"><i class="fa-solid fa-draw-polygon"></i></span>
                <div class="list-card-info">
                    <div class="list-card-title">Çevre Uzunluğu</div>
                    <div class="list-card-sub">${data.perimeterMeters.toLocaleString("tr-TR")} m</div>
                </div>
                <span class="distance-badge">${data.perimeterFormatted}</span>
            </div>
        `);
    }

    listEl.innerHTML = rows.join("");
}

// --- ANALİZ 5: MEKÂNSAL BİRLEŞTİRME & TEMATİK (CHOROPLETH) HARİTA ---
if (btnRunChoropleth) {
    btnRunChoropleth.addEventListener("click", runChoroplethAnalysis);
}

async function runChoroplethAnalysis() {
    stopNearestPickMode();
    stopDrawingMode();
    if (polygonSelectSource) polygonSelectSource.value = "";
    if (bufferSelectDrawing) bufferSelectDrawing.value = "";
    if (measureSelectSource) measureSelectSource.value = "";

    try {
        const res = await fetch(`${API_BASE_URL}/analysis/spatial-join/districts`);
        if (!res.ok) throw new Error("Mekânsal birleştirme analizi başarısız oldu.");

        const data = await res.json();
        displayChoroplethAnalysisResult(data);
    } catch (err) {
        alert("Hata: " + err.message);
    }
}

function displayChoroplethAnalysisResult(data) {
    analysisState.lastOrigin = null;
    analysisState.lastType = "choropleth";
    if (analysisState.originMarker) {
        analysisState.originMarker.remove();
        analysisState.originMarker = null;
    }

    const emptyFc = { type: "FeatureCollection", features: [] };
    analysisState.linesGeoJson = emptyFc;
    analysisState.polygonGeoJson = emptyFc;
    analysisState.hospitalsGeoJson = emptyFc;
    if (map.getSource("analysis-lines-source")) map.getSource("analysis-lines-source").setData(emptyFc);
    if (map.getSource("analysis-polygon-source")) map.getSource("analysis-polygon-source").setData(emptyFc);
    if (map.getSource("analysis-points-source")) map.getSource("analysis-points-source").setData(emptyFc);

    analysisState.choroplethGeoJson = data.choroplethGeoJson;
    if (map.getSource("analysis-choropleth-source")) {
        map.getSource("analysis-choropleth-source").setData(data.choroplethGeoJson);
    } else {
        ensureAllLayersAdded();
    }

    map.flyTo({ center: [29.061, 40.15], zoom: 9.2, speed: 1.2 });

    const headerEl = document.getElementById("analysis-results-header");
    const listEl = document.getElementById("analysis-results-list");
    headerEl.innerText = `17 İlçe • Toplam ${data.totalHospitalsJoined} Hastane`;
    btnClearAnalysis.style.display = "inline-block";
    listEl.innerHTML = "";

    const features = data.choroplethGeoJson?.features || [];
    features.forEach((f) => {
        const p = f.properties;
        const isDarkBadge = p.hospitalCount >= 6;
        const badgeTextColor = isDarkBadge ? "#ffffff" : "#0f172a";

        const card = document.createElement("div");
        card.className = "list-card";
        card.innerHTML = `
            <span class="rank-badge">${p.rank}</span>
            <div class="list-card-info">
                <div class="list-card-title">${p.name}</div>
                <div class="list-card-sub">
                    ${Number(p.areaSqKm).toLocaleString("tr-TR")} km² • ${p.emergencyCount} Acil Servis
                </div>
            </div>
            <span class="distance-badge" style="background:${p.fillColor}; color:${badgeTextColor}; border-color:rgba(15,23,42,0.15);">
                ${p.hospitalCount} Hastane
            </span>
        `;

        card.addEventListener("click", () => {
            const center = zoomToFeatureGeometry(f.geometry);
            if (center) showChoroplethDistrictPopup(p, center);
        });

        listEl.appendChild(card);
    });
}

btnClearAnalysis.addEventListener("click", clearAnalysisResults);

function clearAnalysisResults() {
    stopNearestPickMode();
    stopDrawingMode();
    clearChoroplethLayer();
    analysisState.lastOrigin = null;
    analysisState.lastType = null;
    analysisState.linesGeoJson = null;
    analysisState.polygonGeoJson = null;
    analysisState.hospitalsGeoJson = null;

    if (analysisState.originMarker) {
        analysisState.originMarker.remove();
        analysisState.originMarker = null;
    }

    if (polygonSelectSource) polygonSelectSource.value = "";
    if (bufferSelectDrawing) bufferSelectDrawing.value = "";
    if (measureSelectSource) measureSelectSource.value = "";

    const emptyFc = { type: "FeatureCollection", features: [] };
    if (map.getSource("analysis-lines-source")) {
        map.getSource("analysis-lines-source").setData(emptyFc);
    }
    if (map.getSource("analysis-polygon-source")) {
        map.getSource("analysis-polygon-source").setData(emptyFc);
    }
    if (map.getSource("analysis-points-source")) {
        map.getSource("analysis-points-source").setData(emptyFc);
    }

    btnClearAnalysis.style.display = "none";
    document.getElementById("analysis-results-header").innerText = "Sonuçlar";
    document.getElementById("analysis-results-list").innerHTML = `
        <div class="empty-hint">
            Haritadan bir konum veya alan seçerek analizi başlatın.
        </div>
    `;
}





