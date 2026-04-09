import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { locales, defaultLocale, type Locale } from "./config";
import { parseAcceptLanguage } from "./locale";

export default getRequestConfig(async () => {
  const store = await cookies();
  let locale: Locale | undefined;

  // 1. Cookie
  const cookieValue = store.get("locale")?.value;
  if (cookieValue && locales.includes(cookieValue as Locale)) {
    locale = cookieValue as Locale;
  }

  // 2. Accept-Language
  if (!locale) {
    const acceptLang = (await headers()).get("accept-language") || "";
    locale = parseAcceptLanguage(acceptLang);
  }

  // 3. Fallback
  if (!locale) {
    locale = defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
