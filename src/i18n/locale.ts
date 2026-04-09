import { type Locale, locales, defaultLocale } from "./config";

/**
 * Parse Accept-Language header and return the best matching locale.
 * Example header: "zh-CN,zh;q=0.9,en;q=0.8"
 */
export function parseAcceptLanguage(header: string): Locale {
  const entries = header
    .split(",")
    .map((part) => {
      const [lang, q] = part.trim().split(";q=");
      return { lang: lang.trim(), q: q ? parseFloat(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of entries) {
    // Exact match
    if (locales.includes(lang as Locale)) return lang as Locale;
    // Prefix match: "zh" matches "zh-CN"
    const prefix = lang.split("-")[0];
    const match = locales.find((l) => l.startsWith(prefix + "-") || l === prefix);
    if (match) return match;
  }

  return defaultLocale;
}
