import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import hi from "./locales/hi";

const savedLanguage = localStorage.getItem("sams.language");

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    hi: { translation: hi }
  },
  lng: savedLanguage ?? "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false }
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
}

export function setLanguage(language: "en" | "hi") {
  localStorage.setItem("sams.language", language);
  void i18n.changeLanguage(language);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
}

export default i18n;
