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

    form: { product: null, quantity: 1, note: "", requester: "" },

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

    toasts: [],

    // --- Levenscyclus ---

    init() {
      this.form.requester = this.readName();
      this.adminCode = this.readAdminCode();
      this.loadTab();
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

    async loadTab() {
      this.loading = true;
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
      } catch (error) {
        this.toast(error.message, "error");
      } finally {
        this.loading = false;
      }
    },

    switchTab(tab) {
      if (this.tab === tab) return;
      this.tab = tab;
      this.loadTab();
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
      this.$nextTick(() => this.$refs.quantity?.focus());
    },

    clearProduct() {
      this.form.product = null;
      this.form.quantity = 1;
      this.form.note = "";
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
      if (!this.form.requester) {
        this.toast("Kies je naam", "error");
        return;
      }

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
      if (confirmText && !confirm(confirmText)) return;

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
      if (!confirm("Dit item afwijzen?")) return;
      const reason = (
        prompt("Reden voor afwijzen (optioneel):", "") || ""
      ).trim();

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
      if (!confirm(`"${item.title}" definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`))
        return;

      this.busyId = item.id;
      try {
        await this.api(`/items/${item.id}`, { method: "DELETE" });
        this.items.rejected = this.items.rejected.filter((i) => i.id !== item.id);
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
      if (
        !confirm(`Alle ${this.items.open.length} verzoeken op besteld zetten?`)
      )
        return;

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
