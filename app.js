"use strict";

/*
 * CROCHET NOVA STUDIO
 * GitHub-backed Admin Panel
 *
 * Backend required:
 * POST   /auth/login
 * GET    /products
 * POST   /products
 * PATCH  /products/:id
 * DELETE /products/:id
 * POST   /uploads/drive
 * POST   /uploads/image
 * POST   /sync/sheet7
 */

const CFG = window.CROCHET_CONFIG || {};
const API_BASE = String(CFG.API_BASE_URL || "").replace(/\/+$/, "");
const PAGE_SIZE = Number(CFG.PAGE_SIZE || 24);

let sessionToken = null;
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
// UI HELPERS
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
    const el = $("connectionStatus");
    if (!el) return;

    el.textContent = "● " + message;
    el.style.color = connected ? "#b8d8bd" : "#e6a0a8";
}

function setBusy(button, busy, label) {
    if (!button) return;

    if (busy) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent;
        }

        button.disabled = true;
        button.textContent = label;
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText || label;
        delete button.dataset.originalText;
    }
}

// -----------------------------
// API CONNECTION
// -----------------------------

function requireApiConfig() {
    if (!API_BASE) {
        throw new Error(
            "Backend URL missing. Configure API_BASE_URL in config.js."
        );
    }
}

async function request(path, options = {}, authenticated = true) {
    requireApiConfig();

    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");

    if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
    }

    if (authenticated) {
        if (!sessionToken) {
            throw new Error("Please sign in again.");
        }

        headers.set("Authorization", `Bearer ${sessionToken}`);
    }

    const response = await fetch(API_BASE + path, {
        ...options,
        headers,
        body: options.body === undefined
            ? undefined
            : JSON.stringify(options.body)
    });

    let result = {};

    try {
        result = await response.json();
    } catch {
        throw new Error("Invalid backend response.");
    }

    if (response.status === 401 || response.status === 403) {
        if (authenticated) signOut(false);

        throw new Error(
            result.error || "Session expired or access denied."
        );
    }

    if (!response.ok || result.success === false) {
        throw new Error(
            result.error || `Request failed (${response.status}).`
        );
    }

    return result;
}

// -----------------------------
// ADMIN PASSWORD LOGIN
// -----------------------------

async function login(event) {
    event.preventDefault();

    const button = $("loginBtn");

    setBusy(button, true, "Verifying...");
    $("loginError").textContent = "";

    try {
        const password = $("password").value;

        const result = await request(
            "/auth/login",
            {
                method: "POST",
                body: { password }
            },
            false
        );

        if (!result.token) {
            throw new Error("Backend did not return a session token.");
        }

        sessionToken = result.token;

        $("password").value = "";

        showDashboard();

    } catch (error) {
        $("loginError").textContent = error.message;
    } finally {
        setBusy(button, false, "Sign in");
    }
}

function showDashboard() {
    $("loginView").classList.add("hidden");
    $("dashboard").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");

    setConnection("Connected to GitHub catalog", true);

    resetCatalog();
}

function signOut(showToast = true) {
    sessionToken = null;
    products = [];
    selectedIds.clear();

    $("dashboard").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");

    setConnection("Sign in required", false);

    if (showToast) toast("Signed out.");
}

function logout() {
    signOut(true);
}

// -----------------------------
// PRODUCT LOADING
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

    try {
        const params = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(offset)
        });

        if (searchTerm) {
            params.set("q", searchTerm);
        }

        const result = await request(
            `/products?${params.toString()}`,
            { method: "GET" }
        );

        const rows = result.products || [];

        products.push(...rows);

        offset += rows.length;
        total = Number(result.total ?? products.length);
        hasMore = Boolean(result.has_more);

        renderProducts(rows);
        updateStats();

        $("emptyState").classList.toggle(
            "hidden",
            products.length !== 0
        );

        $("resultLabel").textContent =
            `${total} product${total === 1 ? "" : "s"}`;

        $("loadMoreBtn").classList.toggle("hidden", !hasMore);

    } catch (error) {
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

    $("bulkDeleteBtn").textContent =
        `Delete selected (${selectedIds.size})`;
}

// -----------------------------
// PRODUCT DISPLAY
// -----------------------------

function renderProducts(rows) {
    const html = rows.map(product => {
        const id = escapeHTML(product.ID);
        const name = escapeHTML(product.PRODUCT_NAME);
        const category = escapeHTML(product.CATEGORY);

        const image = product.IMAGE1
            ? `<img class="product-image"
                src="${escapeHTML(product.IMAGE1)}"
                alt="${name}"
                loading="lazy">`
            : `<div class="image-placeholder">C&N</div>`;

        const checked = selectedIds.has(String(product.ID))
            ? "checked"
            : "";

        return `
            <article class="product-card">
                ${image}

                <div class="product-info">

                    <label class="select-row">
                        <input
                            type="checkbox"
                            data-select="${id}"
                            ${checked}
                        >
                        Select product
                    </label>

                    <h3>${name}</h3>

                    <div class="product-meta">
                        ${id} · ${category}
                    </div>

                    <div class="product-price">
                        ₹${Number(product.PRICE || 0).toLocaleString("en-IN")}
                    </div>

                    <div class="product-meta">
                        Stock: ${Number(product.STOCK || 0)}
                    </div>

                    <div class="product-actions">
                        <button class="btn btn-outline"
                            data-edit="${id}">
                            Edit
                        </button>

                        <button class="btn btn-danger"
                            data-delete="${id}">
                            Delete
                        </button>
                    </div>

                </div>
            </article>
        `;
    }).join("");

    $("productGrid").insertAdjacentHTML("beforeend", html);
}

// -----------------------------
// SEARCH
// -----------------------------

function performSearch() {
    searchTerm = $("searchInput").value.trim();
    resetCatalog();
}

// -----------------------------
// PRODUCT EDITOR
// -----------------------------

function openEditor(product = null) {
    editingId = product?.ID ?? null;

    assets = Array.isArray(product?.EXTRA_ASSETS)
        ? JSON.parse(JSON.stringify(product.EXTRA_ASSETS))
        : [];

    $("productForm").reset();

    $("modalTitle").textContent =
        product ? "Edit product" : "Add product";

    $("productId").value = product?.ID || "";
    $("productName").value = product?.PRODUCT_NAME || "";
    $("category").value = product?.CATEGORY || "";
    $("price").value = product?.PRICE ?? 0;
    $("stock").value = product?.STOCK ?? 0;
    $("instagramUrl").value = product?.INSTA_URL || "";
    $("imageUrl").value = product?.IMAGE1 || "";

    $("productId").readOnly = Boolean(product);

    $("badge").value = JSON.stringify(
        product?.BADGE || {},
        null,
        2
    );

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

    $("mainImagePreview").innerHTML = url
        ? `<img src="${escapeHTML(url)}" alt="Main image preview">`
        : "";
}

// -----------------------------
// PRODUCT VALIDATION
// -----------------------------

function validateHttpUrl(value, label) {
    if (!value) return;

    let parsed;

    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${label} must be a valid URL.`);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`${label} must use HTTP or HTTPS.`);
    }
}

function readProductForm() {
    let badge;

    try {
        badge = JSON.parse($("badge").value || "{}");
    } catch {
        throw new Error("BADGE must contain valid JSON.");
    }

    if (!badge || typeof badge !== "object" || Array.isArray(badge)) {
        throw new Error("BADGE must be a JSON object.");
    }

    const product = {
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

    if (!product.ID || !product.PRODUCT_NAME) {
        throw new Error("Product ID and name are required.");
    }

    if (!Number.isFinite(product.PRICE) || product.PRICE < 0) {
        throw new Error("Enter a valid price.");
    }

    if (!Number.isInteger(product.STOCK) || product.STOCK < 0) {
        throw new Error("Stock must be a whole number.");
    }

    validateHttpUrl(product.IMAGE1, "Image URL");
    validateHttpUrl(product.INSTA_URL, "Instagram URL");

    return product;
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
        const product = readProductForm();

        let result;

        if (editingId !== null) {
            const update = { ...product };
            delete update.ID;

            result = await request(
                `/products/${encodeURIComponent(editingId)}`,
                {
                    method: "PATCH",
                    body: update
                }
            );

        } else {
            result = await request(
                "/products",
                {
                    method: "POST",
                    body: product
                }
            );
        }

        closeEditor();

        if (result.sync) {
            showSyncResult(result.sync);
        }

        toast("Product saved to GitHub catalog.");

        resetCatalog();

    } catch (error) {
        $("formError").textContent = error.message;
    } finally {
        setBusy(button, false, "Save product");
    }
}

// -----------------------------
// DELETE PRODUCT
// -----------------------------

async function deleteProduct(id) {
    const product = products.find(
        item => String(item.ID) === String(id)
    );

    if (!confirm(
        `Delete "${product?.PRODUCT_NAME || id}" permanently?`
    )) return;

    try {
        await request(
            `/products/${encodeURIComponent(id)}`,
            { method: "DELETE" }
        );

        selectedIds.delete(String(id));

        toast("Product deleted.");

        resetCatalog();

    } catch (error) {
        toast(error.message);
    }
}

// -----------------------------
// BULK DELETE
// -----------------------------

async function bulkDelete() {
    const ids = [...selectedIds];

    if (!ids.length) return;

    if (!confirm(`Delete ${ids.length} selected products?`)) return;

    const button = $("bulkDeleteBtn");

    setBusy(button, true, "Deleting...");

    try {
        for (const id of ids) {
            await request(
                `/products/${encodeURIComponent(id)}`,
                { method: "DELETE" }
            );
        }

        selectedIds.clear();

        toast("Selected products deleted.");

        resetCatalog();

    } catch (error) {
        showMessage(error.message);
        resetCatalog();
    } finally {
        setBusy(button, false, "Delete selected");
    }
}

// -----------------------------
// IMAGE UPLOAD
// -----------------------------

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            resolve(String(reader.result).split(",")[1]);
        };

        reader.onerror = () => {
            reject(new Error("Unable to read image."));
        };

        reader.readAsDataURL(file);
    });
}

async function uploadFile(file, endpoint) {
    if (!file) throw new Error("Select a file.");

    if (!file.type.startsWith("image/")) {
        throw new Error("Only image files are supported.");
    }

    if (file.size > 8 * 1024 * 1024) {
        throw new Error("Maximum image size is 8 MB.");
    }

    const base64 = await fileToBase64(file);

    const result = await request(endpoint, {
        method: "POST",
        body: {
            productName: $("productName").value.trim() || "Product",
            fileName: file.name,
            mimeType: file.type,
            base64
        }
    });

    if (!result.url) {
        throw new Error("Upload service did not return a URL.");
    }

    return result.url;
}

async function uploadMainImage(file) {
    try {
        toast("Uploading main image...");

        $("imageUrl").value = await uploadFile(
            file,
            "/uploads/drive"
        );

        renderImagePreview();

        toast("Main image uploaded.");

    } catch (error) {
        $("formError").textContent = error.message;
    }
}

async function uploadExtraImage(file) {
    try {
        toast("Uploading extra image...");

        const url = await uploadFile(
            file,
            "/uploads/image"
        );

        assets.push({
            type: "image",
            name: file.name,
            url
        });

        renderAssets();

        toast("Extra image uploaded.");

    } catch (error) {
        $("formError").textContent = error.message;
    }
}

// -----------------------------
// EXTRA ASSETS
// -----------------------------

function addAssetUrl() {
    const url = $("assetUrl").value.trim();

    if (!url) {
        toast("Enter an asset URL.");
        return;
    }

    try {
        validateHttpUrl(url, "Asset URL");
    } catch (error) {
        toast(error.message);
        return;
    }

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
            <b>${escapeHTML(asset.type || "asset")}</b>

            <span>
                ${escapeHTML(asset.name || asset.url)}
            </span>

            <button
                type="button"
                data-remove-asset="${index}"
                aria-label="Remove asset">
                ×
            </button>
        </div>
    `).join("");
}

// -----------------------------
// GOOGLE SHEETS SYNC
// -----------------------------

function showSyncResult(sync) {
    if (sync?.success) {
        $("sheetStatus").textContent = "Synced";

        showMessage(
            "GitHub catalog saved. Sheet7 synchronized.",
            true
        );
    } else {
        $("sheetStatus").textContent = "Pending";

        showMessage(
            "Catalog saved, but Sheet7 synchronization is pending.",
            false
        );
    }
}

async function retrySheetSync() {
    const button = $("syncBtn");

    setBusy(button, true, "Syncing...");

    try {
        await request("/sync/sheet7", {
            method: "POST",
            body: {}
        });

        $("sheetStatus").textContent = "Synced";

        showMessage(
            "Sheet7 synchronized successfully.",
            true
        );

        toast("Google Sheets synchronization complete.");

    } catch (error) {
        $("sheetStatus").textContent = "Failed";
        showMessage(error.message);

    } finally {
        setBusy(button, false, "Sync Sheet7");
    }
}

// -----------------------------
// EVENT LISTENERS
// -----------------------------

function bindEvents() {

    $("loginForm").addEventListener("submit", login);

    $("logoutBtn").addEventListener("click", logout);

    $("addProductBtn").addEventListener(
        "click",
        () => openEditor()
    );

    $("closeModalBtn").addEventListener(
        "click",
        closeEditor
    );

    $("cancelBtn").addEventListener(
        "click",
        closeEditor
    );

    $("productForm").addEventListener(
        "submit",
        saveProduct
    );

    $("imageUrl").addEventListener(
        "input",
        renderImagePreview
    );

    $("mainImageFile").addEventListener("change", event => {
        const file = event.target.files?.[0];

        if (file) uploadMainImage(file);

        event.target.value = "";
    });

    $("extraAssetFile").addEventListener("change", event => {
        const file = event.target.files?.[0];

        if (file) uploadExtraImage(file);

        event.target.value = "";
    });

    $("addAssetBtn").addEventListener(
        "click",
        addAssetUrl
    );

    $("refreshBtn").addEven
