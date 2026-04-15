import { describe, it, expect } from "vitest";
import { buildGoogleCalendarUrl } from "./google-calendar";

describe("buildGoogleCalendarUrl", () => {
  const start = new Date("2026-04-20T14:30:00Z");
  const end = new Date("2026-04-20T15:00:00Z");

  it("returns a Google Calendar TEMPLATE URL", () => {
    const url = buildGoogleCalendarUrl({ title: "Rappel Acme", startAt: start, endAt: end });
    expect(url).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    expect(url).toContain("action=TEMPLATE");
  });

  it("encodes the title", () => {
    const url = buildGoogleCalendarUrl({
      title: "Rappel Morel & Fils",
      startAt: start,
      endAt: end,
    });
    expect(url).toContain("Rappel+Morel+%26+Fils");
  });

  it("formats dates in Google's YYYYMMDDTHHmmssZ format", () => {
    const url = buildGoogleCalendarUrl({ title: "X", startAt: start, endAt: end });
    expect(url).toContain("dates=20260420T143000Z%2F20260420T150000Z");
  });

  it("includes details when provided", () => {
    const url = buildGoogleCalendarUrl({
      title: "X",
      startAt: start,
      endAt: end,
      details: "SIREN 123456789 — Jean Dupont",
    });
    expect(url).toContain("details=SIREN");
  });

  it("omits details and location when undefined", () => {
    const url = buildGoogleCalendarUrl({ title: "X", startAt: start, endAt: end });
    expect(url).not.toContain("details=");
    expect(url).not.toContain("location=");
  });

  it("includes location when provided", () => {
    const url = buildGoogleCalendarUrl({
      title: "X",
      startAt: start,
      endAt: end,
      location: "Lyon",
    });
    expect(url).toContain("location=Lyon");
  });

  it("handles special chars in title without crashing", () => {
    const url = buildGoogleCalendarUrl({
      title: "Rappel é à ç \"test\" <html>",
      startAt: start,
      endAt: end,
    });
    expect(url).toMatch(/^https:\/\/calendar\.google\.com/);
    expect(() => new URL(url)).not.toThrow();
  });
});
