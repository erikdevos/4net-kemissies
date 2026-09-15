// Boodschappentool - Alpine.js component.
// De API draait op hetzelfde domein (/api/...), dus er is geen CORS en geen config.

// Eén plek om collega's toe te voegen of te verwijderen.
const NAMES = [
  "Anne",
  "Chiara",
  "Christiaan",
  "Eddie",
  "Elde",
  "Erik",
  "Fransje",
  "Jean-Pierre",
  "Maikel",
  "Michel",
  "Peggy",
  "Percy",
  "Pim",
  "Remco",
  "Richard",
  "Roel",
  "Sabien",
  "Sander",
  "Steve",
];

const STORAGE_NAME = "boodschappen_naam";
const STORAGE_ADMIN = "boodschappen_admin";
const ADMIN_DAYS = 30;
const MAX_QUANTITY = 10;
const WIPE_CONFIRM_PHRASE = "VERWIJDER ALLES";
const AUTO_REFRESH_MS = 30000;
// Deadline voor de wekelijkse ronde: donderdag 12:00 's middags.
const DEADLINE_WEEKDAY = 4; // 0 = zondag ... 4 = donderdag
const DEADLINE_HOUR = 16;

function boodschappen() {
  return {
    names: NAMES,
    maxQuantity: MAX_QUANTITY,

    tab: "open",
    loading: true,
    submitting: false,
    busyId: null,
    bulkBusy: false,

    items: { open: [], ordered: [], rejected: [] },
    frequent: [],
    frequentQuery: "",

    form: { product: null, quantity: 1, note: "", requester: "" },
    requesterError: "",
    duplicateItem: null,

    query: "",
    results: [],
    searching: false,
    resultsOpen: false,
    searchError: "",
    searchTimer: null,

    adminCode: null,
    showAdminModal: false,
    adminInput: "",
    adminError: "",

    showWipeModal: false,
    wipeConfirmInput: "",
    wipeBusy: false,

    // Eén generieke, native <dialog>-gebaseerde bevestiging voor intrekken,
    // afwijzen en bulk-acties - vervangt de kale confirm()/prompt() dialogen.
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

    lastUpdated: null,
    refreshTimer: null,
    clockTimer: null,
    now: Date.now(),

    toasts: [],

    // --- Levenscyclus ---

    init() {
      this.form.requester = this.readName();
      this.adminCode = this.readAdminCode();
      this.loadTab();
      this.startAutoRefresh();
      this.clockTimer = setInterval(() => (this.now = Date.now()), 30000);
    },

    get isAdmin() {
      return Boolean(this.adminCode);
    },

    get visibleItems() {
      return this.tab === "ordered" ? this.items.ordered : this.items.open;
    },

    get openCount() {
      return this.items.open.reduce((total, item) => total + item.quantity, 0);
    },

    get openCountLabel() {
      const count = this.openCount;
      return `${count} ${count === 1 ? "stuk" : "stuks"}`;
    },

    get filteredFrequent() {
      const query = this.frequentQuery.trim().toLowerCase();
      if (!query) return this.frequent;
      return this.frequent.filter((product) =>
        product.title.toLowerCase().includes(query),
      );
    },

    // Donderdag 12:00 is de deadline voor de ronde van deze week; is die al
    // geweest, dan tellen we af naar volgende week donderdag.
    get deadline() {
      const deadline = new Date(this.now);
      deadline.setHours(DEADLINE_HOUR, 0, 0, 0);
      let daysAhead = (DEADLINE_WEEKDAY - deadline.getDay() + 7) % 7;
      if (daysAhead === 0 && deadline.getTime() <= this.now) daysAhead = 7;
      deadline.setDate(deadline.getDate() + daysAhead);
      return deadline;
    },

    get deadlineLabel() {
      const msLeft = this.deadline.getTime() - this.now;
      const hoursLeft = Math.max(0, Math.round(msLeft / 3600000));
      let countdown;
      if (hoursLeft < 1) countdown = "nog minder dan een uur";
      else if (hoursLeft < 24) countdown = `nog ${hoursLeft} uur`;
      else countdown = `nog ${Math.ceil(hoursLeft / 24)} dagen`;
      return `Deadline voor deze ronde: donderdag 12:00 (${countdown})`;
    },

    get lastUpdatedLabel() {
      if (!this.lastUpdated) return "";
      const seconds = Math.max(
        0,
        Math.round((this.now - this.lastUpdated) / 1000),
      );
      if (seconds < 10) return "zojuist bijgewerkt";
      if (seconds < 60) return `${seconds}s geleden bijgewerkt`;
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `${minutes} min geleden bijgewerkt`;
      const hours = Math.round(minutes / 60);
      return `${hours} uur geleden bijgewerkt`;
    },

    // --- API ---

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

    // --- Laden ---

    async loadTab({ silent = false } = {}) {
      if (!silent) this.loading = true;
      try {
        if (this.tab === "frequent") {
          const { products } = await this.api("/frequent");
          this.frequent = products;
        } else {
          const status =
            this.tab === "ordered"
              ? "ordered"
              : this.tab === "rejected"
                ? "rejected"
                : "open";
          const { items } = await this.api(`/items?status=${status}`);
          this.items[this.tab] = items;
        }
        this.lastUpdated = Date.now();
      } catch (error) {
        if (!silent) this.toast(error.message, "error");
      } finally {
        if (!silent) this.loading = false;
      }
    },

    switchTab(tab) {
      if (this.tab === tab) return;
      this.tab = tab;
      this.loadTab();
    },

    // Ververst de actieve tab elke AUTO_REFRESH_MS zonder laadspinner, zodat
    // wijzigingen van collega's ook zichtbaar worden zonder handmatig te verversen.
    // Staat stil zodra het tabblad niet zichtbaar is, om geen requests te verspillen.
    startAutoRefresh() {
      this.refreshTimer = setInterval(() => {
        if (document.visibilityState === "visible" && !this.loading) {
          this.loadTab({ silent: true });
        }
      }, AUTO_REFRESH_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible")
          this.loadTab({ silent: true });
      });
    },

    // --- Zoeken bij AH ---

    onSearchInput() {
      clearTimeout(this.searchTimer);
      this.searchError = "";

      const query = this.query.trim();
      if (query.length < 2) {
        this.results = [];
        this.resultsOpen = false;
        this.searching = false;
        return;
      }

      this.searching = true;
      this.searchTimer = setTimeout(() => this.runSearch(query), 250);
    },

    async runSearch(query) {
      try {
        const { products } = await this.api(
          `/search?q=${encodeURIComponent(query)}`,
        );
        // Een trager antwoord op een oudere zoekterm mag een nieuwere niet overschrijven.
        if (this.query.trim() !== query) return;
        this.results = products;
        this.resultsOpen = true;
        this.searchError = products.length ? "" : "Geen producten gevonden";
      } catch (error) {
        this.results = [];
        this.resultsOpen = false;
        this.searchError = error.message;
      } finally {
        this.searching = false;
      }
    },

    selectProduct(product) {
      this.form.product = product;
      this.form.quantity = 1;
      this.query = "";
      this.results = [];
      this.resultsOpen = false;
      this.searchError = "";
      this.duplicateItem = this.findDuplicate(product);
      this.$nextTick(() => this.$refs.quantity?.focus());
    },

    clearProduct() {
      this.form.product = null;
      this.form.quantity = 1;
      this.form.note = "";
      this.duplicateItem = null;
    },

    // Staat dit product al open op de lijst, van iemand anders? Dan is "+1" op
    // dat verzoek zetten nuttiger dan een tweede, losse regel aanmaken (van je
    // eigen verzoeken samenvoegen doet de server al automatisch bij het indienen).
    findDuplicate(product) {
      return (
        this.items.open.find((item) => {
          if (this.isMine(item)) return false;
          return product.productId != null
            ? item.productId === product.productId
            : item.title.toLowerCase() === product.title.toLowerCase();
        }) || null
      );
    },

    async boostDuplicate() {
      const item = this.duplicateItem;
      if (!item || this.busyId === item.id) return;

      this.busyId = item.id;
      try {
        const { item: updated } = await this.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { boost: true },
        });
        Object.assign(item, updated);
        this.toast(`+1 gezet op het verzoek van ${item.requester}`);
        this.clearProduct();
        if (this.tab === "open") await this.loadTab({ silent: true });
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    focusSearch() {
      document
        .getElementById("formulier")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      this.$nextTick(() => document.getElementById("zoek")?.focus());
    },

    // Product uit "Vaker besteld" terugzetten in het formulier.
    reuse(product) {
      this.selectProduct({
        productId: product.productId,
        title: product.title,
        brand: product.brand,
        unitSize: product.unitSize,
        imageUrl: product.imageUrl,
        productUrl: product.productUrl,
        price: product.price,
      });
      this.switchTab("open");
      this.$nextTick(() => {
        document
          .getElementById("formulier")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },

    // --- Verzoek indienen ---

    async submit() {
      if (this.submitting) return;

      if (!this.form.product) {
        this.toast("Zoek en kies eerst een product", "error");
        return;
      }
      this.requesterError = this.form.requester ? "" : "Kies je naam";
      if (this.requesterError) return;

      this.submitting = true;
      try {
        const product = this.form.product;
        const { merged } = await this.api("/items", {
          method: "POST",
          body: {
            requester: this.form.requester,
            productId: product.productId,
            title: product.title,
            brand: product.brand,
            unitSize: product.unitSize,
            imageUrl: product.imageUrl,
            productUrl: product.productUrl,
            price: product.price,
            quantity: this.form.quantity,
            note: this.form.note,
          },
        });

        this.toast(merged ? "Aantal opgehoogd" : "Toegevoegd aan de lijst");
        this.clearProduct();

        this.tab = "open";
        await this.loadTab();
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.submitting = false;
      }
    },

    // --- Acties op items ---

    isMine(item) {
      return (
        item.status === "open" &&
        Boolean(this.form.requester) &&
        item.requester.toLowerCase() === this.form.requester.toLowerCase()
      );
    },

    canEdit(item) {
      return this.isAdmin || this.isMine(item);
    },

    async changeQuantity(item, delta) {
      const quantity = Math.min(
        Math.max(item.quantity + delta, 1),
        MAX_QUANTITY,
      );
      if (quantity === item.quantity) return;

      this.busyId = item.id;
      try {
        const { item: updated } = await this.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { quantity, requester: this.form.requester },
        });
        Object.assign(item, updated);
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    async setStatus(item, status, confirmText) {
      if (confirmText) {
        const { confirmed } = await this.askConfirm({ text: confirmText });
        if (!confirmed) return;
      }

      this.busyId = item.id;
      try {
        await this.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { status, requester: this.form.requester },
        });
        await this.loadTab();
        this.toast(this.statusMessage(status));
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    // Alleen de beheerder wijst af, en mag er een reden bij geven. Zelf intrekken
    // (setStatus hierboven) vraagt daar bewust niet naar.
    async rejectItem(item) {
      const { confirmed, reason } = await this.askConfirm({
        title: "Item afwijzen?",
        text: `"${item.title}" wordt van de lijst gehaald.`,
        confirmLabel: "Afwijzen",
        danger: true,
        showReason: true,
      });
      if (!confirmed) return;

      this.busyId = item.id;
      try {
        await this.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { status: "rejected", requester: this.form.requester, reason },
        });
        await this.loadTab();
        this.toast("Afgewezen");
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    // Definitief verwijderen van een afgewezen item: geen soft delete meer, de
    // rij verdwijnt echt uit D1 en dus ook uit het overzicht en de logs.
    async purgeItem(item) {
      const { confirmed } = await this.askConfirm({
        title: "Definitief verwijderen?",
        text: `"${item.title}" wordt definitief verwijderd. Dit kan niet ongedaan gemaakt worden.`,
        confirmLabel: "Definitief verwijderen",
        danger: true,
      });
      if (!confirmed) return;

      this.busyId = item.id;
      try {
        await this.api(`/items/${item.id}`, { method: "DELETE" });
        this.items.rejected = this.items.rejected.filter(
          (i) => i.id !== item.id,
        );
        this.toast("Definitief verwijderd");
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    statusMessage(status) {
      if (status === "ordered") return "Op besteld gezet";
      if (status === "open") return "Teruggezet op de lijst";
      return "Verwijderd";
    },

    async orderAll() {
      if (this.items.open.length === 0) return;
      const { confirmed } = await this.askConfirm({
        title: "Alles op besteld zetten?",
        text: `Alle ${this.items.open.length} verzoeken worden op besteld gezet.`,
        confirmLabel: "Op besteld zetten",
      });
      if (!confirmed) return;

      this.bulkBusy = true;
      try {
        const { ordered } = await this.api("/order-all", { method: "POST" });
        await this.loadTab();
        this.toast(
          `${ordered} ${ordered === 1 ? "item" : "items"} op besteld gezet`,
        );
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.bulkBusy = false;
      }
    },

    // --- Lijst kopieren ---

    async copyList() {
      const items = this.items.open;
      if (items.length === 0) {
        this.toast("De lijst is leeg", "error");
        return;
      }

      // Dezelfde boodschap van meerdere mensen wordt een regel met het totaal.
      const grouped = new Map();
      for (const item of items) {
        const key = item.productId || item.title.toLowerCase();
        const entry = grouped.get(key) || {
          title: item.title,
          quantity: 0,
          names: [],
          notes: [],
        };
        entry.quantity += item.quantity;
        if (!entry.names.includes(item.requester))
          entry.names.push(item.requester);
        if (item.note && !entry.notes.includes(item.note))
          entry.notes.push(item.note);
        grouped.set(key, entry);
      }

      const heading = `Boodschappenlijst ${new Date().toLocaleDateString(
        "nl-NL",
        {
          day: "numeric",
          month: "long",
          year: "numeric",
        },
      )}`;

      const lines = [...grouped.values()].map((entry) => {
        let line = `${entry.quantity}x ${entry.title} (${entry.names.join(", ")})`;
        if (entry.notes.length) line += ` - ${entry.notes.join("; ")}`;
        return line;
      });

      try {
        await navigator.clipboard.writeText([heading, "", ...lines].join("\n"));
        this.toast("Lijst gekopieerd");
      } catch {
        this.toast("Kopieren lukte niet", "error");
      }
    },

    // --- Bevestigingsdialoog ---
    // Eén generiek, native <dialog>-element voor intrekken/afwijzen/bulk-acties,
    // in plaats van de kale browser-confirm()/prompt().

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
      this.$nextTick(() => this.$refs.confirmDialog?.showModal());
      return new Promise((resolve) => {
        this.confirmDialog.resolve = resolve;
      });
    },

    resolveConfirm(confirmed) {
      this.$refs.confirmDialog?.close();
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
      this.$nextTick(() => this.$refs.adminInput?.focus());
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
        await this.loadTab();
      } catch {
        this.adminCode = previous;
        this.adminError = "Die code klopt niet";
      }
    },

    logoutAdmin() {
      this.forgetAdmin();
      this.toast("Uitgelogd");
      this.loadTab();
    },

    forgetAdmin() {
      this.adminCode = null;
      try {
        localStorage.removeItem(STORAGE_ADMIN);
      } catch {
        // localStorage geblokkeerd; niets aan te doen.
      }
    },

    // --- Alles opschonen ---
    // Bewust verstopt (geen zichtbare knop) en pas actief na het exact overtypen
    // van WIPE_CONFIRM_PHRASE: dit is onomkeerbaar en verwijdert echt alles.

    wipeConfirmPhrase: WIPE_CONFIRM_PHRASE,

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
        this.tab = "open";
        this.items = { open: [], ordered: [], rejected: [] };
        this.frequent = [];
        await this.loadTab();
        this.toast("Alles opgeschoond");
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.wipeBusy = false;
      }
    },

    storeAdminCode(code) {
      try {
        const expiresAt = Date.now() + ADMIN_DAYS * 24 * 60 * 60 * 1000;
        localStorage.setItem(
          STORAGE_ADMIN,
          JSON.stringify({ code, expiresAt }),
        );
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

    // --- Naam onthouden ---

    rememberName() {
      this.requesterError = "";
      try {
        localStorage.setItem(STORAGE_NAME, this.form.requester);
      } catch {
        // Zie boven.
      }
    },

    readName() {
      try {
        const stored = localStorage.getItem(STORAGE_NAME);
        return NAMES.includes(stored) ? stored : "";
      } catch {
        return "";
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

    price(value) {
      if (value === null || value === undefined) return "";
      return new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency: "EUR",
      }).format(value);
    },

    date(value) {
      if (!value) return "";
      return new Date(value).toLocaleDateString("nl-NL", {
        day: "numeric",
        month: "short",
      });
    },

    since(value) {
      if (!value) return "";
      const days = Math.floor(
        (Date.now() - new Date(value).getTime()) / 86400000,
      );
      if (days <= 0) return "vandaag";
      if (days === 1) return "gisteren";
      if (days < 14) return `${days} dagen geleden`;
      if (days < 60) return `${Math.floor(days / 7)} weken geleden`;
      return `${Math.floor(days / 30)} maanden geleden`;
    },
  };
}
