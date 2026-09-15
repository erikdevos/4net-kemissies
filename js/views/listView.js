// Alpine-component voor de boodschappenlijst-view (route '/'): zoeken bij AH,
// verzoek indienen, tabs (open/vaker besteld/besteld/afgewezen), item-acties.
// Gedeelde diensten (toasts, bevestigingsdialoog, adminstatus, api-wrapper)
// komen van de Alpine.store via this.$store.app - zie js/app.js.
import { price, date, since, relativeShort } from "../lib/format.js";

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
const MAX_QUANTITY = 10;
const AUTO_REFRESH_MS = 30000;
// Deadline voor de wekelijkse ronde.
const DEADLINE_WEEKDAY = 4; // 0 = zondag ... 4 = donderdag
const DEADLINE_HOUR = 16;

document.addEventListener("alpine:init", () => {
  Alpine.data("listView", () => ({
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

    lastUpdated: null,
    refreshTimer: null,
    clockTimer: null,
    now: Date.now(),

    // --- Levenscyclus ---

    init() {
      this.form.requester = this.readName();
      this.loadTab();

      // Adminstatus en "alles opschonen" leven in de gedeelde Alpine.store
      // (zie js/app.js); deze view moet zijn lijst verversen zodra dat verandert.
      const onAdminChanged = () => this.loadTab({ silent: true });
      const onDataWiped = () => {
        this.tab = "open";
        this.items = { open: [], ordered: [], rejected: [] };
        this.frequent = [];
        this.loadTab();
      };
      window.addEventListener("admin-changed", onAdminChanged);
      window.addEventListener("data-wiped", onDataWiped);

      // Direct verversen zodra het tabblad weer actief wordt (i.p.v. te
      // wachten op de eerstvolgende AUTO_REFRESH_MS-tick).
      const onVisible = () => {
        if (document.visibilityState === "visible")
          this.loadTab({ silent: true });
      };
      document.addEventListener("visibilitychange", onVisible);

      // De route wisselt deze view in/uit via <template x-if>, wat het
      // element (en dus dit component) volledig verwijdert en later opnieuw
      // aanmaakt. Alpine kent geen destroy()-hook voor x-data-fabrieken, dus
      // ruimt de timers/listeners zichzelf op zodra $el niet meer verbonden is.
      const stopIfRemoved = () => {
        if (this.$el.isConnected) return false;
        clearInterval(this.refreshTimer);
        clearInterval(this.clockTimer);
        window.removeEventListener("admin-changed", onAdminChanged);
        window.removeEventListener("data-wiped", onDataWiped);
        document.removeEventListener("visibilitychange", onVisible);
        return true;
      };

      this.refreshTimer = setInterval(() => {
        if (stopIfRemoved()) return;
        if (document.visibilityState === "visible" && !this.loading) {
          this.loadTab({ silent: true });
        }
      }, AUTO_REFRESH_MS);

      this.clockTimer = setInterval(() => {
        if (stopIfRemoved()) return;
        this.now = Date.now();
      }, 30000);
    },

    get isAdmin() {
      return this.$store.app.isAdmin;
    },

    // Eén gedeeld itemrij-blok in index.html rendert open/besteld/afgewezen
    // via deze array, met `tab` als discriminator voor welke metadata/acties
    // getoond worden (zie template: :class, x-show="tab === '...'").
    get currentTabItems() {
      if (this.tab === "ordered") return this.items.ordered;
      if (this.tab === "rejected") return this.items.rejected;
      return this.items.open;
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

    // Is de deadline al geweest deze week, dan tellen we af naar volgende week.
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
      const time = `${String(DEADLINE_HOUR).padStart(2, "0")}:00`;
      return `Deadline voor deze ronde: donderdag ${time} (${countdown})`;
    },

    get lastUpdatedLabel() {
      return relativeShort(this.lastUpdated, this.now);
    },

    // --- Laden ---

    async loadTab({ silent = false } = {}) {
      if (!silent) this.loading = true;
      try {
        if (this.tab === "frequent") {
          const { products } = await this.$store.app.api("/frequent");
          this.frequent = products;
        } else {
          const status =
            this.tab === "ordered"
              ? "ordered"
              : this.tab === "rejected"
                ? "rejected"
                : "open";
          const { items } = await this.$store.app.api(`/items?status=${status}`);
          this.items[this.tab] = items;
        }
        this.lastUpdated = Date.now();
      } catch (error) {
        if (!silent) this.$store.app.toast(error.message, "error");
      } finally {
        if (!silent) this.loading = false;
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
        const { products } = await this.$store.app.api(
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
        const { item: updated } = await this.$store.app.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { boost: true },
        });
        Object.assign(item, updated);
        this.$store.app.toast(`+1 gezet op het verzoek van ${item.requester}`);
        this.clearProduct();
        if (this.tab === "open") await this.loadTab({ silent: true });
      } catch (error) {
        this.$store.app.toast(error.message, "error");
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
        this.$store.app.toast("Zoek en kies eerst een product", "error");
        return;
      }
      this.requesterError = this.form.requester ? "" : "Kies je naam";
      if (this.requesterError) return;

      this.submitting = true;
      try {
        const product = this.form.product;
        const { merged } = await this.$store.app.api("/items", {
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

        this.$store.app.toast(merged ? "Aantal opgehoogd" : "Toegevoegd aan de lijst");
        this.clearProduct();

        this.tab = "open";
        await this.loadTab();
      } catch (error) {
        this.$store.app.toast(error.message, "error");
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
        const { item: updated } = await this.$store.app.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { quantity, requester: this.form.requester },
        });
        Object.assign(item, updated);
      } catch (error) {
        this.$store.app.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    async setStatus(item, status, confirmText) {
      if (confirmText) {
        const { confirmed } = await this.$store.app.askConfirm({ text: confirmText });
        if (!confirmed) return;
      }

      this.busyId = item.id;
      try {
        await this.$store.app.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { status, requester: this.form.requester },
        });
        await this.loadTab();
        this.$store.app.toast(this.statusMessage(status));
      } catch (error) {
        this.$store.app.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    // Alleen de beheerder wijst af, en mag er een reden bij geven. Zelf intrekken
    // (setStatus hierboven) vraagt daar bewust niet naar.
    async rejectItem(item) {
      const { confirmed, reason } = await this.$store.app.askConfirm({
        title: "Item afwijzen?",
        text: `"${item.title}" wordt van de lijst gehaald.`,
        confirmLabel: "Afwijzen",
        danger: true,
        showReason: true,
      });
      if (!confirmed) return;

      this.busyId = item.id;
      try {
        await this.$store.app.api(`/items/${item.id}`, {
          method: "PATCH",
          body: { status: "rejected", requester: this.form.requester, reason },
        });
        await this.loadTab();
        this.$store.app.toast("Afgewezen");
      } catch (error) {
        this.$store.app.toast(error.message, "error");
      } finally {
        this.busyId = null;
      }
    },

    // Definitief verwijderen van een afgewezen item: geen soft delete meer, de
    // rij verdwijnt echt uit D1 en dus ook uit het overzicht en de logs.
    async purgeItem(item) {
      const { confirmed } = await this.$store.app.askConfirm({
        title: "Definitief verwijderen?",
        text: `"${item.title}" wordt definitief verwijderd. Dit kan niet ongedaan gemaakt worden.`,
        confirmLabel: "Definitief verwijderen",
        danger: true,
      });
      if (!confirmed) return;

      this.busyId = item.id;
      try {
        await this.$store.app.api(`/items/${item.id}`, { method: "DELETE" });
        this.items.rejected = this.items.rejected.filter(
          (i) => i.id !== item.id,
        );
        this.$store.app.toast("Definitief verwijderd");
      } catch (error) {
        this.$store.app.toast(error.message, "error");
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
      const { confirmed } = await this.$store.app.askConfirm({
        title: "Alles op besteld zetten?",
        text: `Alle ${this.items.open.length} verzoeken worden op besteld gezet.`,
        confirmLabel: "Op besteld zetten",
      });
      if (!confirmed) return;

      this.bulkBusy = true;
      try {
        const { ordered } = await this.$store.app.api("/order-all", { method: "POST" });
        await this.loadTab();
        this.$store.app.toast(
          `${ordered} ${ordered === 1 ? "item" : "items"} op besteld gezet`,
        );
      } catch (error) {
        this.$store.app.toast(error.message, "error");
      } finally {
        this.bulkBusy = false;
      }
    },

    // --- Lijst kopieren ---

    async copyList() {
      const items = this.items.open;
      if (items.length === 0) {
        this.$store.app.toast("De lijst is leeg", "error");
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
        { day: "numeric", month: "long", year: "numeric" },
      )}`;

      const lines = [...grouped.values()].map((entry) => {
        let line = `${entry.quantity}x ${entry.title} (${entry.names.join(", ")})`;
        if (entry.notes.length) line += ` - ${entry.notes.join("; ")}`;
        return line;
      });

      try {
        await navigator.clipboard.writeText([heading, "", ...lines].join("\n"));
        this.$store.app.toast("Lijst gekopieerd");
      } catch {
        this.$store.app.toast("Kopieren lukte niet", "error");
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

    price,
    date,
    since,
  }));
});
