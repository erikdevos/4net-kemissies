// Gedeelde weergave-helpers. Pure functies, geen Alpine-afhankelijkheid.

export function price(value) {
  if (value === null || value === undefined) return "";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function date(value, { withYear = false } = {}) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

// Relatieve tijd in dagen, voor "Vaker besteld"-kaarten (Campina melk, 3 dagen geleden).
export function since(value) {
  if (!value) return "";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return "vandaag";
  if (days === 1) return "gisteren";
  if (days < 14) return `${days} dagen geleden`;
  if (days < 60) return `${Math.floor(days / 7)} weken geleden`;
  return `${Math.floor(days / 30)} maanden geleden`;
}

// Relatieve tijd in seconden/minuten/uren, voor de "laatst bijgewerkt"-indicatie.
export function relativeShort(from, now = Date.now()) {
  if (!from) return "";
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 10) return "zojuist bijgewerkt";
  if (seconds < 60) return `${seconds}s geleden bijgewerkt`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min geleden bijgewerkt`;
  const hours = Math.round(minutes / 60);
  return `${hours} uur geleden bijgewerkt`;
}
