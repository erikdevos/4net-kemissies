// Gedeelde app-state als Alpine.store: routing, toasts, beheer/adminCode, de
// generieke bevestigingsdialoog, en de API-fetch-wrapper. Views (listView/
// statsView) bereiken dit via this.$store.app - in tegenstelling tot Alpine's
// $root/$refs/$nextTick/$dispatch is $store NIET element-gebonden, en werkt
// dus wél betrouwbaar over componentgrenzen heen (zie ook de toelichting bij
// de dialoog-methodes hieronder, die bewust plain DOM-APIs gebruiken i.p.v.
// $refs/$nextTick, want die zijn binnen een store niet beschikbaar).
import { initRouter } from "./router.js";
import "./views/listView.js";
import "./views/statsView.js";

const STORAGE_ADMIN = "boodschappen_admin";
const ADMIN_DAYS = 30;
const WIPE_CONFIRM_PHRASE = "VERWIJDER ALLES";

document.addEventListener("alpine:init", () => {
  Alpine.store("app", {
    route: "list",

    adminCode: null,
    showAdminModal: false,
    adminInput: "",
    adminError: "",

    showWipeModal: false,
    wipeConfirmInput: "",
    wipeConfirmPhrase: WIPE_CONFIRM_PHRASE,
    wipeBusy: false,

    // Eén generieke, native <dialog>-gebaseerde bevestiging voor intrekken,
    // afwijzen en bulk-acties - vervangt de kale browser-confirm()/prompt().
    confirmDialog: {
      title: "",
      text: "",
      confirmLabel: "Bevestigen",
      danger: false,
      showReason: false,
      reasonLabel: "Reden (optioneel)",
      reason: "",
      resolve: null,
    },

    toasts: [],

    init() {
      initRouter((route) => {
        this.route = route;
      });
      this.adminCode = this.readAdminCode();
    },

    get isAdmin() {
      return Boolean(this.adminCode);
    },

    // --- API ---
    // Gedeeld door listView en statsView via this.$store.app.api(...).
    // Statsview heeft geen admincode nodig, maar de header meesturen is
    // onschadelijk.

    async api(path, { method = "GET", body } = {}) {
      const headers = {};
      if (body) headers["Content-Type"] = "application/json";
      if (this.adminCode) headers["X-Admin-Code"] = this.adminCode;

      const response = await fetch(`/api${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        // Geen JSON terug: laat de statuscode het verhaal vertellen.
      }

      if (!response.ok) {
        // Een afgekeurde admincode betekent dat de opgeslagen code niet meer klopt.
        if (
          response.status === 403 &&
          this.adminCode &&
          data.error === "Admincode vereist"
        ) {
          this.forgetAdmin();
        }
        throw new Error(data.error || `Er ging iets mis (${response.status})`);
      }

      return data;
    },

    // --- Bevestigingsdialoog ---
    // Gebruikt bewust document.getElementById() + queueMicrotask() in plaats
    // van Alpine's $refs/$nextTick: die magics zijn element-gebonden en dus
    // niet beschikbaar binnen een store.

    askConfirm({
      title = "Weet je het zeker?",
      text = "",
      confirmLabel = "Bevestigen",
      danger = false,
      showReason = false,
      reasonLabel = "Reden (optioneel)",
    }) {
      Object.assign(this.confirmDialog, {
        title,
        text,
        confirmLabel,
        danger,
        showReason,
        reasonLabel,
        reason: "",
      });
      queueMicrotask(() =>
        document.getElementById("confirm-dialog")?.showModal(),
      );
      return new Promise((resolve) => {
        this.confirmDialog.resolve = resolve;
      });
    },

    resolveConfirm(confirmed) {
      document.getElementById("confirm-dialog")?.close();
      const resolve = this.confirmDialog.resolve;
      const reason = this.confirmDialog.reason.trim();
      this.confirmDialog.resolve = null;
      resolve?.({ confirmed, reason });
    },

    // --- Beheer ---

    openAdminModal() {
      this.adminInput = "";
      this.adminError = "";
      this.showAdminModal = true;
      queueMicrotask(() => document.getElementById("admin-code-input")?.focus());
    },

    async confirmAdmin() {
      const code = this.adminInput.trim();
      if (!code) return;

      const previous = this.adminCode;
      this.adminCode = code;
      try {
        await this.api("/admin", { method: "POST" });
        this.storeAdminCode(code);
        this.showAdminModal = false;
        this.toast("Ingelogd als beheerder");
        window.dispatchEvent(new CustomEvent("admin-changed"));
      } catch {
        this.adminCode = previous;
        this.adminError = "Die code klopt niet";
      }
    },

    logoutAdmin() {
      this.forgetAdmin();
      this.toast("Uitgelogd");
      window.dispatchEvent(new CustomEvent("admin-changed"));
    },

    forgetAdmin() {
      this.adminCode = null;
      try {
        localStorage.removeItem(STORAGE_ADMIN);
      } catch {
        // localStorage geblokkeerd; niets aan te doen.
      }
    },

    storeAdminCode(code) {
      try {
        const expiresAt = Date.now() + ADMIN_DAYS * 24 * 60 * 60 * 1000;
        localStorage.setItem(STORAGE_ADMIN, JSON.stringify({ code, expiresAt }));
      } catch {
        // Niet kunnen onthouden is vervelend, niet fataal.
      }
    },

    readAdminCode() {
      try {
        const stored = localStorage.getItem(STORAGE_ADMIN);
        if (!stored) return null;
        const { code, expiresAt } = JSON.parse(stored);
        if (!code || Date.now() > expiresAt) {
          localStorage.removeItem(STORAGE_ADMIN);
          return null;
        }
        return code;
      } catch {
        return null;
      }
    },

    // --- Alles opschonen ---
    // Bewust verstopt (geen zichtbare knop) en pas actief na het exact overtypen
    // van WIPE_CONFIRM_PHRASE: dit is onomkeerbaar en verwijdert echt alles.

    get wipeConfirmMatches() {
      return this.wipeConfirmInput.trim() === WIPE_CONFIRM_PHRASE;
    },

    openWipeModal() {
      this.wipeConfirmInput = "";
      this.showWipeModal = true;
    },

    async confirmWipe() {
      if (!this.wipeConfirmMatches || this.wipeBusy) return;

      this.wipeBusy = true;
      try {
        await this.api("/wipe", {
          method: "POST",
          body: { confirm: this.wipeConfirmInput.trim() },
        });
        this.showWipeModal = false;
        this.toast("Alles opgeschoond");
        window.dispatchEvent(new CustomEvent("data-wiped"));
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.wipeBusy = false;
      }
    },

    // --- Weergave ---

    toast(message, type = "success") {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, message, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 4000);
    },
  });
});
