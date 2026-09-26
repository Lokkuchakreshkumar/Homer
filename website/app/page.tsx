import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Archive,
  Check,
  Database,
  ExternalLink,
  FileText,
  Layers,
  LockKeyhole,
  Map,
  MousePointer2,
  Search,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { Demo } from "@/components/demo";
import { SiteHeader } from "@/components/site-header";
import { content } from "@/data/content";
import { liveSearchBoundary } from "@/lib/live-search";

function SectionLabel({ children }: { readonly children: string }) {
  return <p className="eyebrow section-label">{children}</p>;
}

const heroFixture = content.demo.fixtures[0];

function HStamp({ className = "stamped-h" }: { readonly className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      H
    </span>
  );
}

const mockIcons = [FileText, Layers, Database, Archive, Map, Search];

function MockSidebar() {
  return (
    <aside className="mock-sidebar" aria-label={content.heroWindow.sidebarLabel}>
      <div className="mock-icon-grid" aria-hidden="true">
        {mockIcons.map((Icon, index) => (
          <span key={index} className={`mock-app-icon mock-app-${index + 1}`}>
            <Icon size={18} />
          </span>
        ))}
      </div>
      <p className="mock-sidebar-label">{content.heroWindow.sidebarLabel}</p>
      <ul className="mock-outline">
        {content.heroWindow.sidebarOutlineItems.map((item, index) => (
          <li key={item} aria-current={index === 1 ? "true" : undefined}>
            <span className="mock-outline-dot" aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
      <p className="mock-sidebar-label">{content.heroWindow.sidebarRecentLabel}</p>
      <ul className="mock-recent">
        {content.demo.queries.map((query) => {
          const fixture =
            query.fixture === null
              ? null
              : content.demo.fixtures.find((entry) => entry.key === query.fixture);
          return (
            <li key={query.key}>
              <span className="mock-recent-text">{query.text}</span>
              <span className="mock-recent-note">
                {fixture ? fixture.passageNumber : content.heroWindow.sidebarNoMatch}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#top">
        {content.site.skipLink}
      </a>
      <SiteHeader />
      <noscript>
        <div className="noscript-note">
          {content.site.noscript} <a href="#install">{content.site.noscriptLink}</a>
          {content.site.noscriptSuffix}
        </div>
      </noscript>

      <main id="top" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-canvas">
            <SectionLabel>{content.site.category}</SectionLabel>
            <h1 id="hero-title">{content.site.promise}</h1>
            <p className="hero-support">{content.site.support}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#install">
                {content.site.primaryAction}
                <ArrowDown size={16} aria-hidden="true" />
              </a>
              <a className="button button-secondary" href="#product">
                {content.site.secondaryAction}
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="hero-mock-wrap">
            <div className="hero-product-frame" role="region" aria-label={content.heroWindow.ariaLabel}>
              <div className="browser-bar">
                <div className="window-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="browser-address">
                  <span className="window-lock" aria-hidden="true">●</span>
                  <span>{content.heroWindow.address}</span>
                </div>
                <span className="browser-menu">{content.heroWindow.menuLabel}</span>
              </div>
              <div className="hero-mock-body">
                <MockSidebar />
                <div className="hero-product-body">
                  <div className="hero-product-toolbar">
                    <span className="toolbar-kicker">{content.heroWindow.toolbarLabel}</span>
                    <span className="toolbar-status">
                      <span className="status-dot" aria-hidden="true" />
                      {content.heroFrame.signalLabel}
                    </span>
                  </div>
                  <article className="hero-document">
                    <div className="document-meta">
                      <span>{content.heroWindow.pageMeta}</span>
                      <span>{content.heroFrame.topLabel}</span>
                    </div>
                    <div className="hero-document-heading">
                      <HStamp className="page-stamp" />
                      <div>
                        <p>{content.heroFrame.kicker}</p>
                        <h2>{content.heroFrame.title}</h2>
                      </div>
                    </div>
                    <p className="hero-document-copy">{content.heroFrame.copy}</p>
                    <div className="hero-query">
                      <Search size={16} aria-hidden="true" />
                      <span>{content.heroFrame.query}</span>
                      <span className="query-enter" aria-hidden="true">↵</span>
                    </div>
                    <div className="hero-answer">
                      <span>{heroFixture.answerLabel}</span>
                      <p>
                        {heroFixture.answer.before}
                        <mark>{heroFixture.answer.emphasis}</mark>
                        {heroFixture.answer.after}
                      </p>
                    </div>
                    <div className="hero-document-footer">
                      <span>{content.heroWindow.footerLabel}</span>
                      <span>{content.heroWindow.promptLabel}</span>
                    </div>
                  </article>
                </div>
              </div>
            </div>
          </div>

          <div className="hero-strip" aria-label={content.hero.shortcut.ariaLabel}>
            <div className="hero-strip-intro">
              <span>{content.hero.shortcut.label}</span>
              <strong>{content.hero.shortcut.note}</strong>
            </div>
            <div className="shortcut-keys" aria-label={content.hero.shortcut.keysLabel}>
              <kbd>{content.hero.shortcut.primaryKey}</kbd>
              <span>+</span>
              <kbd>{content.hero.shortcut.secondaryKey}</kbd>
            </div>
            <div className="hero-strip-facts">
              {content.hero.facts.slice(1).map((fact) => (
                <span key={fact}>{fact}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-problem" id="problem" aria-labelledby="problem-title">
          <div className="site-shell intro-split" aria-label={content.problem.label}>
            <p className="intro-split-label">{content.problem.label}</p>
            <div className="intro-split-grid">
              <p>{content.problem.body}</p>
              <p>{content.reader.body}</p>
            </div>
          </div>

          <div className="site-shell centered-statement">
            <SectionLabel>{content.problem.label}</SectionLabel>
            <h2 id="problem-title">{content.problem.displayTitle}</h2>
            <p>{content.problem.body}</p>
          </div>

          <div className="site-shell problem-stage">
            <div className="stage-topline">
              <span>{content.chapters.comparisonLabel}</span>
              <span className="stage-signal">{content.chapters.comparisonSignal}</span>
            </div>
            <div className="problem-comparison">
              <article className="problem-card problem-card-exact">
                <div className="problem-card-topline">
                  <span>{content.problem.exactLabel}</span>
                  <MousePointer2 size={17} aria-hidden="true" />
                </div>
                <h3>{content.problem.exactTitle}</h3>
                <div className="find-preview" aria-hidden="true">
                  <span>{content.chapters.findLabel}</span>
                  <div className="find-input">{content.problem.exactTitle}</div>
                  <div className="find-lines">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <p>{content.problem.exactBody}</p>
              </article>

              <div className="problem-arrow" aria-hidden="true">
                <ArrowRight size={20} />
              </div>

              <article className="problem-card problem-card-meaning">
                <div className="problem-card-topline">
                  <span>{content.problem.meaningLabel}</span>
                  <span className="meaning-mark" aria-hidden="true">✦</span>
                </div>
                <h3>{content.problem.meaningTitle}</h3>
                <div className="answer-preview" aria-hidden="true">
                  <span>{heroFixture.answerLabel}</span>
                  <p>
                    {heroFixture.answer.before}
                    <mark>{heroFixture.answer.emphasis}</mark>
                    {heroFixture.answer.after}
                  </p>
                </div>
                <p>{content.problem.meaningBody}</p>
              </article>
            </div>
            <div className="stage-footer">
              <a className="text-link" href="#product">
                {content.problem.actionLabel}
                <ArrowDown size={15} aria-hidden="true" />
              </a>
              <span>{content.hero.note}</span>
            </div>
          </div>

          <div className="site-shell tilt-strip" aria-hidden="true">
            <div className="tilt-grid">
              {content.demo.queries.map((query) => (
                <span key={query.key} className="tilt-chip">
                  {query.text}
                </span>
              ))}
              <span className="tilt-chip tilt-chip-keys">
                {content.hero.shortcut.primaryKey} + {content.hero.shortcut.secondaryKey}
              </span>
              {content.hero.facts.map((fact) => (
                <span key={fact} className="tilt-chip tilt-chip-faint">
                  {fact}
                </span>
              ))}
            </div>
          </div>

          <div className="site-shell reader-strip">
            <HStamp className="reader-stamp" />
            <div>
              <SectionLabel>{content.reader.label}</SectionLabel>
              <h2>{content.reader.title}</h2>
              <p>{content.reader.body}</p>
            </div>
            <p className="reader-note">{content.reader.note}</p>
          </div>
        </section>

        <section className="section section-product" id="product" aria-labelledby="product-title">
          <div className="site-shell">
            <div className="centered-statement">
              <SectionLabel>{content.demo.label}</SectionLabel>
              <h2 id="product-title">{content.product.title}</h2>
              <p>{content.product.body}</p>
            </div>
            <Demo />
            <div className="product-footnote">
              <HStamp className="footnote-mark" />
              <p>{content.product.footnote}</p>
            </div>
          </div>
        </section>

        <section className="section section-how" id="how-it-works" aria-labelledby="how-title">
          <div className="site-shell">
            <div className="centered-statement">
              <SectionLabel>{content.how.label}</SectionLabel>
              <h2 id="how-title">{content.how.title}</h2>
              <p>{content.how.body}</p>
            </div>
            <div className="workflow-grid">
              {content.how.steps.map((step, index) => (
                <article className="workflow-card" key={step.number}>
                  <div className="workflow-card-topline">
                    <span>{step.number}</span>
                    <span>{content.how.panelNote}</span>
                  </div>
                  <div className={`workflow-visual workflow-visual-${index + 1}`} aria-hidden="true">
                    {index === 0 ? (
                      <>
                        <div className="mini-browser-bar"><i /><i /><i /></div>
                        <div className="mini-browser-page"><span /><span /><span /><b>{content.hero.shortcut.primaryKey}&nbsp; {content.hero.shortcut.secondaryKey}</b></div>
                      </>
                    ) : index === 1 ? (
                      <>
                        <span className="visual-label">{content.chapters.questionLabel}</span>
                        <div className="visual-query">{content.demo.queries[0].text}</div>
                        <div className="visual-cursor" />
                      </>
                    ) : (
                      <>
                        <span className="visual-label">{content.chapters.resultLabel}</span>
                        <div className="visual-result"><i /><i /><b /></div>
                        <div className="visual-context"><i /><i /></div>
                      </>
                    )}
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </article>
              ))}
            </div>
            <a className="text-link section-link" href="#privacy">
              {content.how.linkLabel}
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="section section-privacy" id="privacy" aria-labelledby="privacy-title">
          <div className="site-shell">
            <div className="centered-statement privacy-statement">
              <SectionLabel>{content.privacy.label}</SectionLabel>
              <h2 id="privacy-title">{content.privacy.title}</h2>
              <p>{content.privacy.body}</p>
            </div>
            <div className="privacy-panel">
              <div className="privacy-panel-heading">
                <span className="privacy-heading-icon">
                  <ShieldCheck size={22} aria-hidden="true" />
                </span>
                <div>
                  <p className="eyebrow">{content.privacy.flowLabel}</p>
                  <h3>{content.privacy.boundaryTitle}</h3>
                </div>
              </div>
              <div className="privacy-flow" aria-label={content.privacy.flowLabel}>
                <div className="flow-node">
                  <span>{content.privacy.flow.inputLabel}</span>
                  <strong>{content.privacy.flow.inputBody}</strong>
                </div>
                <ArrowRight className="flow-arrow" size={18} aria-hidden="true" />
                <div className="flow-node flow-node-accent">
                  <span>{content.privacy.flow.proxyLabel}</span>
                  <strong>{content.privacy.flow.proxyBody}</strong>
                </div>
                <ArrowRight className="flow-arrow" size={18} aria-hidden="true" />
                <div className="flow-node">
                  <span>{content.privacy.flow.outputLabel}</span>
                  <strong>{content.privacy.flow.outputBody}</strong>
                </div>
              </div>
              <div className="privacy-detail-grid">
                <div className="privacy-detail">
                  <p className="eyebrow">{content.privacy.detailLabel}</p>
                  <p>{content.privacy.conditional}</p>
                  <p>{content.privacy.unknown}</p>
                  <div className="website-boundary">
                    <LockKeyhole size={17} aria-hidden="true" />
                    <div>
                      <strong>{content.privacy.searchBoundaryLabel} {liveSearchBoundary.mode}</strong>
                      <span>{content.privacy.demoBoundary} {content.privacy.sideNote}</span>
                    </div>
                  </div>
                </div>
                <div className="privacy-detail">
                  <p className="eyebrow">{content.privacy.requestLabel}</p>
                  <ul className="check-list">
                    {content.privacy.bullets.map((item) => (
                      <li key={item}>
                        <Check size={16} aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <a className="text-link section-link" href="#install">
              {content.privacy.linkLabel}
              <ArrowDown size={15} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className="section section-install" id="install" aria-labelledby="install-title">
          <div className="site-shell">
            <div className="centered-statement">
              <SectionLabel>{content.install.label}</SectionLabel>
              <h2 id="install-title">{content.install.title}</h2>
              <p>{content.install.body}</p>
            </div>
            <div className="install-panel">
              <div className="install-steps-card">
                <div className="install-card-topline">
                  <span>{content.install.sourceLabel}</span>
                  <Terminal size={17} aria-hidden="true" />
                </div>
                <ol className="install-list">
                  {content.install.steps.map((step, index) => (
                    <li key={step}>
                      <span>0{index + 1}</span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
                <p className="install-tip">{content.install.tip}</p>
              </div>
              <div className="install-details">
                <div className="install-detail">
                  <h3>{content.install.browserTitle}</h3>
                  <p>{content.install.browserBody}</p>
                </div>
                <div className="install-detail install-detail-signal">
                  <h3>{content.install.mobileTitle}</h3>
                  <p>{content.install.mobile}</p>
                </div>
                <div className="install-links" aria-label={content.install.linksLabel}>
                  {content.install.links.map((link) => (
                    <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
                      <span>{link.label}</span>
                      <ExternalLink size={15} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section section-faq" id="faq" aria-labelledby="faq-title">
          <div className="site-shell faq-layout">
            <div className="centered-statement faq-intro">
              <SectionLabel>{content.faq.label}</SectionLabel>
              <h2 id="faq-title">{content.faq.title}</h2>
              <p>{content.faq.intro}</p>
              <a className="text-link" href="#product">
                {content.faq.linkLabel}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </div>
            <div className="faq-list">
              {content.faq.items.map((item, index) => (
                <details key={item.question} open={index === 0}>
                  <summary>
                    <span>{item.question}</span>
                    <span className="faq-plus" aria-hidden="true">+</span>
                  </summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="site-shell closing-card">
            <HStamp className="closing-mark" />
            <SectionLabel>{content.closing.label}</SectionLabel>
            <h2 id="closing-title">{content.closing.title}</h2>
            <p>{content.closing.body}</p>
            <div className="closing-actions">
              <a className="button button-primary" href="#install">
                {content.site.primaryAction}
                <ArrowDown size={16} aria-hidden="true" />
              </a>
              <a
                className="button button-secondary"
                href={content.closing.documentation.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {content.closing.documentation.label}
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </div>
            <p className="closing-note">{content.closing.note}</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell footer-inner">
          <div className="footer-brand">
            <HStamp className="stamped-h" />
            <span>{content.footer.status}</span>
          </div>
          <nav aria-label={content.footer.navLabel}>
            {content.footer.links.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            ))}
            <a href="#top">{content.footer.backToTop}</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
