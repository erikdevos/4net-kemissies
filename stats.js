// Statistieken per persoon - Alpine.js component.
// Puur informatief, geen acties: geen admincode, geen mutaties.

function stats() {
  return {
    requesters: [],
    selected: "",
    log: [],
    topProducts: [],
    topOverall: [],
    topRequester: null,
    topProduct: null,
    loading: false,
    errorMessage: "",

    async init() {
      const { requesters, topOverall, topRequester, topProduct } =
        await this.api("/stats");
      this.requesters = requesters;
      this.topOverall = topOverall;
      this.topRequester = topRequester;
      this.topProduct = topProduct;
    },

    async api(path) {
      const response = await fetch(`/api${path}`);
      let data = {};
      try {
        data = await response.json();
      } catch {
        // Geen JSON terug: laat de statuscode het verhaal vertellen.
      }
      if (!response.ok) {
        throw new Error(data.error || `Er ging iets mis (${response.status})`);
      }
      return data;
    },

    async selectRequester(requester) {
      this.selected = requester;
      if (!requester) {
        this.log = [];
        this.topProducts = [];
        return;
      }

      this.loading = true;
      this.errorMessage = "";
      try {
        const data = await this.api(
          `/stats?requester=${encodeURIComponent(requester)}`,
        );
        this.log = data.log;
        this.topProducts = data.topProducts;
      } catch (error) {
        this.log = [];
        this.topProducts = [];
        this.errorMessage = error.message;
      } finally {
        this.loading = false;
      }
    },

    statusLabel(status) {
      if (status === "ordered") return "Besteld";
      if (status === "rejected") return "Afgewezen";
      if (status === "deleted") return "Ingetrokken";
      return "Open";
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
        year: "numeric",
      });
    },
  };
}
