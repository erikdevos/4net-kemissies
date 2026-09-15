// Minimale hash-router. Geen build-stap, geen dependency: leest location.hash,
// valt terug op 'list' voor alles wat niet herkend wordt, en roept setRoute()
// aan bij elke wijziging (inclusief de eerste keer, synchroon).

const ROUTES = {
  "": "list",
  "#/": "list",
  "#/stats": "stats",
};

export function initRouter(setRoute) {
  const read = () => setRoute(ROUTES[location.hash] || "list");
  window.addEventListener("hashchange", read);
  read();
}
