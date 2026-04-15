/**
 * Helper pour generer une URL Google Calendar preremplie.
 * Pas d'OAuth — c'est l'URL publique qu'on ouvre en nouvel onglet.
 * L'utilisateur confirme dans Google pour creer l'evenement chez lui.
 */

type BuildUrlInput = {
  title: string;
  startAt: Date;
  endAt: Date;
  details?: string;
  location?: string;
};

// Format UTC YYYYMMDDTHHmmssZ (sans ponctuation, comme attendu par Google)
function toGoogleDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildGoogleCalendarUrl(input: BuildUrlInput): string {
  const { title, startAt, endAt, details, location } = input;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${toGoogleDate(startAt)}/${toGoogleDate(endAt)}`,
  });
  if (details) params.set("details", details);
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
