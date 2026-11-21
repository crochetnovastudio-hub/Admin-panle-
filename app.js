
"use strict";

const CFG = window.CROCHET_CONFIG;

const sb = window.supabase.createClient(
    CFG.SUPABASE_URL,
    CFG.SUPABASE_ANON_KEY
);

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
    el.textContent = message;
    el.style.display = "block";

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
        el.style.display = "none";
    }, 3200);
}

function showMessage(message, success = false) {
    const el = $("messageBox");

    el.textContent = message;
    el.classList.remove("hidden");

    el.style.background = success ? "#1e382e" : "#492f3a";
    el.style.color = success ? "#b9e4c9" : "#f2c8d1";
}

function setConnection(message, connected = false) {
    $("connectionStatus").textContent =
        (connected ? "● " : "● ") + message;

    $("connectionStatus").style.color =
        connected ? "#b8d8bd" : "#e6a0a8";
}

function setBusy(button, busy, text) {
    button.disabled = busy;

    if (busy) {
        button.dataset.oldText = button.textContent;
        button.textContent = text;
    } else {
        button.textContent =
            button.dataset.oldText || text;
    }
}

// -----------------------------
// AUTHENTICATED API
// -----------------------------

async function api(method, path = "", body) {
    const { data, error } = await sb.auth.getSession();

    if (error) throw error;

    const token = data.session?.access_token;

    if (!token) {
        throw new Error("Session expired. Please sign in again.");
    }

    const headers = {
        "Authorization": `Bearer ${token}`,
        "apikey": CFG.SUPABASE_ANON_KEY
    };

    const options = {
        method,
        headers
    };

    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(CFG.API_URL + path, options);

    let result;

    try {
        result = await response.json();
    } catch {
        throw new Error("Invalid API response. Check your Edge Function.");
    }

    if (!response.ok || result.success === false) {
        throw new Error(
            result.error || `Request failed (${response.status})`
        );
    }

    return result;
}

// -----------------------------
// LOGIN AND SESSION
// -----------------------------

async function login(event) {
    event.preventDefault();

    const button = $("loginBtn");

    setBusy(button, true, "Signing in...");

    $("loginError").textContent = "";

    try {
        const { data, error } = await sb.auth.signInWithPassword({
            email: $("email").value.trim(),
            password: $("password").value
        });

        if (error) throw error;

        if (data.user.app_metadata?.role !== "admin") {
            await sb.auth.signOut();

            throw new Error(
                "This account does not have admin permission."
            );
        }

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

    setConnection("Connected", true);

    resetCatalog();
}

async function logout() {
    await sb.auth.signOut();

    products = [];
    selectedIds.clear();

    $("dashboard").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");

    setConnection("Signed out", false);
}

async function checkExistingSession() {
    try {
        const { data } = await sb.auth.getSession();

        if (!data.session) {
            setConnection("Sign in required");
            return;
        }

        const { data: userData, error } = await sb.auth.getUser();

        if (error) throw error;

        if (userData.user?.app_metadata?.role !== "admin") {
            await sb.auth.signOut();
            setConnection("Admin access required");
            return;
        }

        showDashboard();

    } catch (error) {
        setConnection("Connection error");
        console.error(error);
    }
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
    $("loading").classList.remove("hidden");

    try {
        const params = new URLSearchParams({
            limit: String(CFG.PAGE_SIZE),
            offset: String(offset)
        });

        if (searchTerm) {
            params.set("q", searchTerm);
        }

        const result = await api("GET", "?" + params.toString());

        const newProducts = result.products || [];

        products.push(...newProducts);

        offset += newProducts.length;
        total = Number(result.total || 0);
        hasMore = Boolean(result.has_more);

        renderProducts(newProducts);
        updateStats();

        if (products.length === 0) {
            $("emptyState").classList.remove("hidden");
        } else {
            $("emptyState").classList.add("hidden");
        }

        $("resultLabel").textContent =
            `${total} product${total === 1 ? "" : "s"}`;

        $("loading").textContent =
            hasMore ? "More products available" : "All products loaded";

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

    $("bulkDeleteBtn").textContent =
        `Delete selected (${selectedIds.size})`;
}

// -----------------------------
// PRODUCT CARDS
// -----------------------------

function renderProducts(list) {
    const html = list.map(product => {
        const id = escapeHTML(product.ID);
        const name = escapeHTML(product.PRODUCT_NAME);
        const category = escapeHTML(product.CATEGORY);
        const image = product.IMAGE1
            ? `<img class="product-image"
                    src="${escapeHTML(product.IMAGE1)}"
                    alt="${name}"
                    loading="lazy"
                    onerror="this.style.display='none'">`
            : `<div class="image-placeholder">C&N</div>`;

        const checked = selectedIds.has(product.ID)
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
                        <button
                            class="btn btn-outline"
                            data-edit="${id}"
                        >Edit</button>

                        <button
                            class="btn btn-danger"
                            data-delete="${id}"
                        >Delete</button>
                    </div>

                </div>
            </article>
        `;
    }).join("");

    $("productGrid").insertAdjacentHTML("beforeend", html);
}

// -----------------------------
// SEARCH AND PAGINATION
// -----------------------------

function performSearch() {
    searchTerm = $("searchInput").value.trim();
    resetCatalog();
}

function loadMore() {
    loadProducts();
}

// -----------------------------
// PRODUCT MODAL
// -----------------------------

function openEditor(product = null) {
    editingId = product?.ID || null;

    assets = Array.isArray(product?.EXTRA_ASSETS)
        ? structuredClone(product.EXTRA_ASSETS)
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
// FILE CONVERSION AND UPLOAD
// -----------------------------

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const value = String(reader.result);
            resolve(value.split(",")[1]);
        };

        reader.onerror = () => reject(
            new Error("Unable to read selected file.")
        );

        reader.readAsDataURL(file);
    });
}

async function uploadFile(file, action) {
    if (!file) throw new Error("Select a file first.");

    if (!file.type.startsWith("image/")) {
        throw new Error("Only image files are supported by this uploader.");
    }

    if (file.size > 8 * 1024 * 1024) {
        throw new Error("Maximum upload size is 8 MB.");
    }

    const base64 = await fileToBase64(file);

    const result = await api("POST", "", {
        action,
        productName: $("productName").value.trim() || "Product",
        fileName: file.name,
        mimeType: file.type,
        base64
    });

    if (!result.url) {
        throw new Error("Upload did not return an image URL.");
    }

    return result.url;
}

async function uploadMainImage(file) {
    try {
        toast("Uploading main image to Google Drive...");

        const url = await uploadFile(file, "upload-drive");

        $("imageUrl").value = url;

        renderImagePreview();

        toast("Main image uploaded.");

    } catch (error) {
        $("formError").textContent = error.message;
    }
}

async function uploadExtraImage(file) {
    try {
        toast("Uploading extra image to ImgBB...");

        const url = await uploadFile(file, "upload-imgbb");

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
        const parsed = new URL(url);

        if (!["http:", "https:"].includes(parsed.protocol)) {
            throw new Error();
        }
    } catch {
        toast("Enter a valid HTTP or HTTPS URL.");
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
            <span>${escapeHTML(asset.name || asset.url)}</span>

            <button
                type="button"
                data-remove-asset="${index}"
                aria-label="Remove asset"
            >×</button>
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
        let badge;

        try {
            badge = JSON.parse($("badge").value || "{}");
        } catch {
            throw new Error("BADGE must contain valid JSON.");
        }

        if (!badge || typeof badge !== "object" || Array.isArray(badge)) {
            throw new Error("BADGE must be a JSON object.");
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
            throw new Error("Product ID and name are required.");
        }

        if (
            !Number.isFinite(payload.PRICE) ||
            payload.PRICE < 0 ||
            !Number.isInteger(payload.STOCK) ||
            payload.STOCK < 0
        ) {
            throw new Error("Enter a valid price and whole-number stock.");
        }

        let result;

        if (editingId) {
            delete payload.ID;

            result = await api(
                "PATCH",
                "?id=" + encodeURIComponent(editingId),
                payload
            );
        } else {
            result = await api("POST", "", payload);
        }

        closeEditor();

        showSyncResult(result.sync);

        toast(editingId ? "Product updated." : "Product created.");

        resetCatalog();

    } catch (error) {
        $("formError").textContent = error.message;
    } finally {
        setBusy(button, false, "Save product");
    }
}

function showSyncResult(sync) {
    if (sync?.success) {
        $("sheetStatus").textContent = "Synced";
        showMessage("Supabase saved successfully. Sheet7 synchronized.", true);
    } else {
        $("sheetStatus").textContent = "Pending";
        showMessage(
            "Supabase saved successfully, but Sheet7 synchronization failed. Use Retry Sync. " +
            (sync?.error || ""),
            false
        );
    }
}

// -----------------------------
// DELETE PRODUCT
// -----------------------------

async function deleteProduct(id) {
    const product = products.find(item => item.ID === id);

    if (!confirm(
        `Delete "${product?.PRODUCT_NAME || id}" permanently?`
    )) return;

    try {
        const result = await api(
            "DELETE",
            "?id=" + encodeURIComponent(id)
        );

        showSyncResult(result.sync);

        selectedIds.delete(id);

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
        // The current Edge Function deletes one product per request.
        // It also syncs Sheet7 after each deletion.
        for (const id of ids) {
            await api(
                "DELETE",
                "?id=" + encodeURIComponent(id)
            );
        }

        selectedIds.clear();

        toast("Selected products deleted.");

        resetCatalog();

    } catch (error) {
        showMessage("Some products may have been deleted. " + error.message);
        resetCatalog();
    } finally {
        setBusy(button, false, "Delete selected");
    }
}

// -----------------------------
// GOOGLE SHEETS SYNC
// -----------------------------

async function retrySheetSync() {
    const button = $("syncBtn");

    setBusy(button, true, "Syncing...");

    try {
        const result = await api("POST", "", {
            action: "sync-sheets"
        });

        if (!result.sync?.success) {
            throw new Error(result.sync?.error || "Sheet sync failed.");
        }

        $("sheetStatus").textContent = "Synced";

        showMessage("Sheet7 synchronized successfully.", true);

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

    $("addProductBtn").addEventListener("click", () => openEditor());

    $("closeModalBtn").addEventListener("click", closeEditor);
    $("cancelBtn").addEventListener("click", closeEditor);

    $("productForm").addEventListener("submit", saveProduct);

    $("imageUrl").addEventListener("input", renderImagePreview);

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

    $("addAssetBtn").addEventListener("click", addAssetUrl);

    $("refreshBtn").addEventListener("click", resetCatalog);

    $("searchBtn").addEventListener("click", performSearch);

    $("searchInput").addEventListener("keydown", event => {
        if (event.key === "Enter") performSearch();
    });

    $("loadMoreBtn").addEventListener("click", loadMore);

    $("syncBtn").addEventListener("click", retrySheetSync);

    $("bulkDeleteBtn").addEventListener("click", bulkDelete);

    $("productGrid").addEventListener("click", event => {
        const editButton = event.target.closest("[data-edit]");
        const deleteButton = event.target.closest("[data-delete]");

  
        if (editButton) {
            const product = products.find(
                item => item.ID === editButton.dataset.edit
            );

            if (product) {
                openEditor(product);
            }
        }

        if (deleteButton) {
            deleteProduct(deleteButton.dataset.delete);
        }
    });

    // Product selection
    $("productGrid").addEventListener("change", event => {
        const checkbox = event.target.closest("[data-select]");

        if (!checkbox) return;

        const id = checkbox.dataset.select;

        if (checkbox.checked) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }

        updateStats();
    });

    // Remove extra asset
    $("assetList").addEventListener("click", event => {
        const button = event.target.closest("[data-remove-asset]");

        if (!button) return;

        const index = Number(button.dataset.removeAsset);

        assets.splice(index, 1);

        renderAssets();
    });

    // Close modal when clicking outside
    $("productDialog").addEventListener("click", event => {
        if (event.target === $("productDialog")) {
            closeEditor();
        }
    });

    // Authentication state
    sb.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session) {
            $("dashboard").classList.add("hidden");
            $("logoutBtn").classList.add("hidden");
            $("loginView").classList.remove("hidden");
        }
    });
}

// -----------------------------
// START APPLICATION
// -----------------------------

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    checkExistingSession();
});
