import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  ArrowRight,
  BarChart3,
  CheckSquare,
  FileSpreadsheet,
  GraduationCap,
  MessageCircle,
  ShieldAlert,
  Sparkles
} from "lucide-react";
import { setLanguage } from "../i18n";

export default function LandingPage() {
  const { t, i18n } = useTranslation();

  const features = [
    { icon: <CheckSquare size={20} />, title: t("landing.featureAttendanceTitle"), body: t("landing.featureAttendanceBody") },
    { icon: <MessageCircle size={20} />, title: t("landing.featureAlertsTitle"), body: t("landing.featureAlertsBody") },
    { icon: <BarChart3 size={20} />, title: t("landing.featureReportsTitle"), body: t("landing.featureReportsBody") },
    { icon: <FileSpreadsheet size={20} />, title: t("landing.featureTransferTitle"), body: t("landing.featureTransferBody") },
    { icon: <ShieldAlert size={20} />, title: t("landing.featureAuditTitle"), body: t("landing.featureAuditBody") }
  ];

  const stats = [
    { value: "2", label: t("landing.statRoles") },
    { value: "2", label: t("landing.statLanguages") },
    { value: "0", label: t("landing.statManual") }
  ];

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="landing-brand">
          <div className="landing-mark">
            <GraduationCap size={20} />
          </div>
          <div>
            SAMS
            <span>{t("common.appName")}</span>
          </div>
        </div>

        <div className="landing-nav-actions">
          <a className="landing-link" href="#features">
            {t("landing.navFeatures")}
          </a>
          <select
            aria-label={t("common.language")}
            value={i18n.language}
            onChange={(event) => setLanguage(event.target.value as "en" | "hi")}
            style={{ width: "auto", minWidth: 0, padding: "0.35rem 0.5rem" }}
          >
            <option value="en">EN</option>
            <option value="hi">HI</option>
          </select>
          <Link className="landing-btn primary" to="/login">
            {t("landing.primaryCta")}
          </Link>
        </div>
      </nav>

      <header className="landing-hero">
        <span className="landing-pill">
          <Sparkles size={14} />
          {t("landing.badge")}
        </span>
        <h1>
          {t("landing.heroTitlePrefix")} <em>{t("landing.heroTitleAccent")}</em>
        </h1>
        <p>{t("landing.heroSubtitle")}</p>
        <div className="landing-cta">
          <Link className="landing-btn primary" to="/login">
            {t("landing.primaryCta")}
            <ArrowRight size={16} />
          </Link>
          <a className="landing-btn ghost" href="#features">
            {t("landing.secondaryCta")}
          </a>
        </div>
      </header>

      <div className="landing-stats">
        {stats.map((stat) => (
          <div className="landing-stat" key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>

      <section className="landing-section" id="features">
        <div className="landing-section-head">
          <h2>{t("landing.featuresTitle")}</h2>
          <p>{t("landing.featuresSubtitle")}</p>
        </div>
        <div className="landing-features">
          {features.map((feature) => (
            <article className="landing-feature" key={feature.title}>
              <div className="landing-feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>
          SAMS - {t("landing.footerNote")}
        </span>
        <span>{t("landing.footerTagline")}</span>
      </footer>
    </div>
  );
}
