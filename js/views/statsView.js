// Alpine-component voor de statistieken-view (route '/stats'). Puur
// informatief, geen mutaties: geen admincode nodig, alleen this.$store.app.api()
// (de gedeelde Alpine.store, zie js/app.js) voor de fetch-wrapper.
import { price, date } from "../lib/format.js";

document.addEventListener("alpine:init", () => {
  Alpine.data("statsView", () => ({
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
        await this.$store.app.api("/stats");
      this.requesters = requesters;
      this.topOverall = topOverall;
      this.topRequester = topRequester;
      this.topProduct = topProduct;
    },

    // De globale top 10 en (zodra iemand gekozen is) de top 10 van die
    // persoon delen exact dezelfde velden, dus worden ze via één gedeeld
    // <template x-for>-blok in index.html gerenderd, aangestuurd door deze lijst.
    get productSections() {
      const sections = [
        {
          title: "Top 10 meest besteld (globaal)",
          products: this.topOverall,
          emptyText: "Nog niets besteld.",
        },
      ];
      if (this.selected) {
        sections.push({
          title: `Top 10 meest besteld · ${this.selected}`,
          products: this.topProducts,
          emptyText: "Nog niets besteld voor deze persoon.",
        });
      }
      return sections;
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
        const data = await this.$store.app.api(
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

    price,
    date: (value) => date(value, { withYear: true }),
  }));
});
