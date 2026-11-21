"use strict";

const CFG = window.CROCHET_CONFIG;

// Initialize Supabase client using config variables
const sb = window.supabase.createClient(
    CFG.SUPABASE_URL,
    CFG.SUPABASE_ANON_KEY
);

const $ = id => document.getElementById(id);

// -----------------------------
// UI HELPERS
// -----------------------------

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
// AUTHENTICATION & SESSION
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

        // Optional check for admin role in app_metadata
        if (data.user.app_metadata?.role !== "admin") {
            await sb.auth.signOut();
            throw new Error("This account does not have admin permission.");
        }

        showDashboard();
        toast("Welcome back, Admin!");

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
}

async function logout() {
    await sb.auth.signOut();
    $("dashboard").classList.add("hidden");
    $("loginView").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
    setConnection("Signed out", false);
    toast("Signed out successfully.");
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
// EVENT BINDINGS
// -----------------------------

function bindEvents() {
    const loginForm = $("loginForm");
    if (loginForm) loginForm.addEventListener("submit", login);

    const logoutBtn = $("logoutBtn");
    if (logoutBtn) logoutBtn.addEventListener("click", logout);

    // Listen for auth state changes
    sb.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || !session) {
            $("dashboard")?.classList.add("hidden");
            $("logoutBtn")?.classList.add("hidden");
            $("loginView")?.classList.remove("hidden");
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    checkExistingSession();
});
    
