"use strict";

const CFG = window.CROCHET_CONFIG;

let products = [];
let total = 0;
let offset = 0;
let hasMore = false;
let loading = false;
let editingId = null;
let assets = [];
let searchTerm = "";
let selectedIds = new Set();

const $ = id => document.getElementById(id);

// -----------------------------
// UI HELPERS & TOASTS
// -----------------------------

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function toast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.style.display = "block";

    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
        el.style.display = "none";
    }, 3200);
}

function showMessage(message, success = false) {
    const el = $("messageBox");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
    el.style.background = success ? "#1e382e" : "#492f3a";
    el.style.color = success ? "#b9e4c9" : "#f2c8d1";
}

function setConnection(message, connected = false) {
    const statusEl = $("connectionStatus");
    if (!statusEl) return;
    statusEl.textContent = (connected ? "● " : "● ") + message;
    statusEl.style.color = connected ? "#b8d8bd" : "#e6a0a8";
}

function setBusy(button, busy, text) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
        button.dataset.oldText = button.textContent;
        button.textContent = text;
    } else {
        button.textContent = button.dataset.oldText || text;
    }
}

// -----------------------------
// BACKEND API CLIENT (APPS SCRIPT)
// -----------------------------

async function api(method, action, payload = {}) {
    if (!CFG.APPS_SCRIPT_URL) {
        throw new Error("Google Apps Script URL is not configured in config.js");
    }

    const options = {
        method: method,
        headers: {
            "Content-Type": "text/plain;charset=utf-8" // Avoids CORS preflight issues with Apps Script
        },
        body: JSON.stringify({ action, ...payload })
    };

    const response = await fetch(CFG.APPS_SCRIPT_URL, options);
    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("Invalid response received from Apps Script backend.");
    }

    if (!response.ok || result.success === false) {
        throw new Error(result.error || `Request failed with status ${response.status}`);
    }

    return result;
}

// -----------------------------
// AUTHENTICATION & SESSION
// -----------------------------

function login(event) {
    event.preventDefault();
    const button = $("loginBtn");
    setBusy(button, true, "Verifying...");
    $("loginError").textContent = "";

    const enteredPassword = $("password").value;

    setTimeout(() => {
        if (enteredPassword === CFG.ADMIN_PASSWORD) {
            localStorage.setItem("crochet_admin_auth", "true");
            showDashboard();
            toast("Welcome back, Admin!");
        } else {
            $("loginError").textContent = "Incorrect admin password.";
        }
        setBusy(button, false, "Sign in");
    }, 400);
}

function showDashboard() {
    $("loginView").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    setConnection("Connected to Studio", true);
    resetCatalog();
}

function logout() {
    localStorage.removeItem("crochet_admin_auth");
    products = [];
    selectedIds.clear();

    $("dashboard").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
    setConnection("Signed out", false);
    toast("Signed out successfully.");
}

function checkExistingSession() {
    const isAuth = localStorage.getItem("crochet_admin_auth");
    if (isAuth === "true") {
        showDashboard();
    } else {
        setConnection("Sign in required");
    }
}

// -----------------------------
// PRODUCT CATALOG MANAGEMENT
// -----------------------------

function resetCatalog() {
    products = [];
    total = 0;
    offset = 0;
    hasMore = true;
    loading = false;
    selectedIds.clear();

    $("productGrid").innerHTML = "";
    $("emptyState").classList.add("hidden");
    $("loading").classList.remove("hidden");

    updateStats();
    loadProducts();
}

async function loadProducts() {
    if (loading || !hasMore) return;
    loading = true;
    $("loading").classList.remove("hidden");

    try {
        const result = await api("POST", "getProducts", {
            limit: CFG.PAGE_SIZE,
            offset: offset,
            search: searchTerm
        });

        const newProducts = result.products || [];
        products.push(...newProducts);

        offset += newProducts.length;
        total = Number(result.total || products.length);
        hasMore = Boolean(result.has_more);

        renderProducts(newProducts);
        updateStats();

        $("emptyState").classList.toggle("hidden", products.length > 0);
        $("resultLabel").textContent = `${total} product${total === 1 ? "" : "s"}`;
        $("loading").textContent = hasMore ? "Scroll or load more" : "All products loaded";
        $("loadMoreBtn").classList.toggle("hidden", !hasMore);

    } catch (error) {
        $("loading").textContent = error.message;
        toast(error.message);
    } finally {
        loading = false;
        $("loading").classList.add("hidden");
    }
}

function updateStats() {
    $("totalCount").textContent = total;
    $("loadedCount").textContent = products.length;
    $("bulkDeleteBtn").disabled = selectedIds.size === 0;
    $("bulkDeleteBtn").textContent = `Delete selected (${selectedIds.size})`;
}

// -----------------------------
// RENDERING PRODUCT CARDS
// -----------------------------

function renderProducts(list) {
    const html = list.map(product => {
        const id = escapeHTML(product.ID);
        const name = escapeHTML(product.PRODUCT_NAME);
        const category = escapeHTML(product.CATEGORY);
        const image = product.IMAGE1
            ? `<img class="product-image" src="${escapeHTML(product.IMAGE1)}" alt="${name}" loading="lazy" onerror="this.style.display='none'">`
            : `<div class="image-placeholder">C&N</div>`;

        const checked = selectedIds.has(product.ID) ? "checked" : "";

        return `
            <article class="product-card">
                ${image}
                <div class="product-info">
                    <label class="select-row">
                        <input type="checkbox" data-select="${id}" ${checked}>
                        Select product
                    </label>
                    <h3>${name}</h3>
                    <div class="product-meta">${id} · ${category}</div>
                    <div class="product-price">₹${Number(product.PRICE || 0).toLocaleString("en-IN")}</div>
                    <div class="product-meta">Stock: ${Number(product.STOCK || 0)}</div>
                    <div class="product-actions">
                        <button class="btn btn-outline" data-edit="${id}">Edit</button>
                        <button class="btn btn-danger" data-delete="${id}">Delete</button>
                    </div>
                </div>
            </article>
        `;
    }).join("");

    $("productGrid").insertAdjacentHTML("beforeend", html);
}

// -----------------------------
// SEARCH & PAGINATION
// -----------------------------

function performSearch() {
    searchTerm = $("searchInput").value.trim();
    resetCatalog();
}

function loadMore() {
    loadProducts();
}

// -----------------------------
// PRODUCT MODAL EDITOR
// -----------------------------

function openEditor(product = null) {
    editingId = product?.ID || null;
    assets = Array.isArray(product?.EXTRA_ASSETS) ? structuredClone(product.EXTRA_ASSETS) : [];

    $("productForm").reset();
    $("modalTitle").textContent = product ? "Edit Product" : "Add New Product";

    $("productId").value = product?.ID || "";
    $("productName").value = product?.PRODUCT_NAME || "";
    $("category").value = product?.CATEGORY || "";
    $("price").value = product?.PRICE ?? 0;
    $("stock").value = product?.STOCK ?? 0;
    $("instagramUrl").value = product?.INSTA_URL || "";
    $("imageUrl").value = product?.IMAGE1 || "";
    $("productId").readOnly = Boolean(product);

    $("badge").value = JSON.stringify(product?.BADGE || {}, null, 2);
    $("formError").textContent = "";

    renderImagePreview();
    renderAssets();
    $("productDialog").showModal();
}

function closeEditor() {
    $("productDialog").close();
}

function renderImagePreview() {
    const url = $("imageUrl").value.trim();
    $("mainImagePreview").innerHTML = url ? `<img src="${escapeHTML(url)}" alt="Preview">` : "";
}

// -----------------------------
// IMGBB IMAGE UPLOADER
// -----------------------------

async function uploadToImgBB(file) {
    if (!CFG.IMGBB_API_KEY) {
        throw new Error("ImgBB API key is missing in config.js");
    }

    const formData = new FormData();
    formData.append("image", file);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${CFG.IMGBB_API_KEY}`, {
        method: "POST",
        body: formData
    });

    const data = await response.json();
    if (!data.success) {
        throw new Error("ImgBB upload failed.");
    }
    return data.data.url;
}

async function handleImageUpload(file, isMain = true) {
    try {
        toast("Uploading image to ImgBB...");
        const url = await uploadToImgBB(file);

        if (isMain) {
            $("imageUrl").value = url;
            renderImagePreview();
            toast("Main image uploaded successfully.");
        } else {
            assets.push({ type: "image", name: file.name, url });
            renderAssets();
            toast("Extra image uploaded successfully.");
        }
    } catch (error) {
        $("formError").textContent = error.message;
        toast("Upload failed.");
    }
}

// -----------------------------
// EXTRA ASSETS
// -----------------------------

function addAssetUrl() {
    const url = $("assetUrl").value.trim();
    if (!url) return toast("Enter an asset URL.");

    assets.push({
        type: $("assetType").value,
        name: url.split("/").pop() || "Asset",
        url
    });

    $("assetUrl").value = "";
    renderAssets();
}

function renderAssets() {
    $("assetList").innerHTML = assets.map((asset, index) => `
        <div class="asset-item">
            <b>${escapeHTML(asset.type)}</b>
            <span>${escapeHTML(asset.name || asset.url)}</span>
            <button type="button" data-remove-asset="${index}">×</button>
        </div>
    `).join("");
}

// -----------------------------
// SAVE PRODUCT
// -----------------------------

async function saveProduct(event) {
    event.preventDefault();
    const button = $("saveBtn");
    setBusy(button, true, "Saving...");
    $("formError").textContent = "";

    try {
        let badge = {};
        try {
            badge = JSON.parse($("badge").value || "{}");
        } catch {
            throw new Error("BADGE must contain valid JSON.");
        }

        const payload = {
            ID: $("productId").value.trim(),
            PRODUCT_NAME: $("productName").value.trim(),
            CATEGORY: $("category").value.trim(),
            PRICE: Number($("price").value),
            STOCK: Number($("stock").value),
            IMAGE1: $("imageUrl").value.trim(),
            EXTRA_ASSETS: assets,
            INSTA_URL: $("instagramUrl").value.trim(),
            BADGE: badge
        };

        if (!payload.ID || !payload.PRODUCT_NAME) {
            throw new Error("Product ID and Name are required.");
        }

        const action = editingId ? "updateProduct" : "createProduct";
        await api("POST", action, { product: payload, id: editingId });

        closeEditor();
        toast(editingId ? "Product updated successfully." : "Product created successfully.");
        resetCatalog();

    } catch (error) {
        $("formError").textContent = error.message;
    } finally {
        setBusy(button, false, "Save Product");
    }
}

// -----------------------------
// DELETE & BULK DELETE
// -----------------------------

async function deleteProduct(id) {
    const product = products.find(item => item.ID === id);
    if (!confirm(`Delete "${product?.PRODUCT_NAME || id}" permanently?`)) return;

    try {
        await api("POST", "deleteProduct", { id });
        selectedIds.delete(id);
        toast("Product deleted.");
        resetCatalog();
    } catch (error) {
        toast(error.message);
    }
}

async function bulkDelete() {
    const ids = [...selectedIds];
    if (!ids.length || !confirm(`Delete ${ids.length} selected products?`)) return;

    const button = $("bulkDeleteBtn");
    setBusy(button, true, "Deleting...");

    try {
        await api("POST", "bulkDeleteProducts", { ids });
        selectedIds.clear();
        toast("Selected products deleted.");
        resetCatalog();
    } catch (error) {
        toast(error.message);
        resetCatalog();
    } finally {
        setBusy(button, false, "Delete selected");
    }
}

// -----------------------------
// GOOGLE SHEETS / APPS SCRIPT SYNC
// -----------------------------

async function syncSheets() {
    const button = $("syncBtn");
    setBusy(button, true, "Syncing...");

    try {
        const result = await api("POST", "syncSheets");
        $("sheetStatus").textContent = "Synced";
        showMessage("Google Sheets synchronized successfully.", true);
        toast("Sync complete.");
    } catch (error) {
        $("sheetStatus").textContent = "Failed";
        showMessage(error.message);
    } finally {
        setBusy(button, false, "Sync Sheets");
    }
}

// -----------------------------
// EVENT BINDINGS
// -----------------------------

function bindEvents() {
    $("loginForm").addEventListener("submit", login);
    $("logoutBtn").addEventListener("click", logout);
    $("addProductBtn").addEventListener("click", () => openEditor());
    $("closeModalBtn").addEventListener("click", closeEditor);
    $("cancelBtn").addEventListener("click", closeEditor);
    $("productForm").addEventListener("submit", saveProduct);

    $("imageUrl").addEventListener("input", renderImagePreview);

    $("mainImageFile").addEventListener("change", e => {
        const file = e.target.files?.[0];
        if (file) handleImageUpload(file, true);
        e.target.value = "";
    });

    $("extraAssetFile").addEventListener("change", e => {
        const file = e.target.files?.[0];
        if (file) handleImageUpload(file, false);
        e.target.value = "";
    });

    $("addAssetBtn").addEventListener("click", addAssetUrl);
    $("refreshBtn").addEventListener("click", resetCatalog);
    $("searchBtn").addEventListener("click", performSearch);
    $("searchInput").addEventListener("keydown", e => { if (e.key === "Enter") performSearch(); });
    $("loadMoreBtn").addEventListener("click", loadMore);
    $("syncBtn").addEventListener("click", syncSheets);
    $("bulkDeleteBtn").addEventListener("click", bulkDelete);

    $("productGrid").addEventListener("click", e => {
        const editBtn = e.target.closest("[data-edit]");
        const deleteBtn = e.target.closest("[data-delete]");

        if (editBtn) {
            const product = products.find(i => i.ID === editBtn.dataset.edit);
            if (product) openEditor(product);
        }
        if (deleteBtn) {
            deleteProduct(deleteBtn.dataset.delete);
        }
    });

    $("productGrid").addEventListener("change", e => {
        const checkbox = e.target.closest("[data-select]");
        if (!checkbox) return;
        const id = checkbox.dataset.select;
        if (checkbox.checked) selectedIds.add(id);
        else selectedIds.delete(id);
        updateStats();
    });

    $("assetList").addEventListener("click", e => {
        const btn = e.target.closest("[data-remove-asset]");
        if (!btn) return;
        assets.splice(Number(btn.dataset.removeAsset), 1);
        renderAssets();
    });

    $("productDialog").addEventListener("click", e => {
        if (e.target === $("productDialog")) closeEditor();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    checkExistingSession();
});
