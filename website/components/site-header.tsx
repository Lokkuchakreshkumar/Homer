"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";

import { content } from "@/data/content";

export function SiteHeader() {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuRef.current?.open) {
        return;
      }
      event.preventDefault();
      menuRef.current.open = false;
      setMenuOpen(false);
      menuRef.current.querySelector("summary")?.focus();
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const closeMenu = () => {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
    setMenuOpen(false);
  };

  return (
    <header className="site-header">
      <div className="site-shell header-inner">
        <a className="wordmark" href="#top" aria-label={content.header.homeLabel}>
          <span className="stamped-h" aria-hidden="true">
            H
          </span>
          <span className="wordmark-copy">
            <strong>{content.site.name}</strong>
            <small>{content.header.wordmarkNote}</small>
          </span>
        </a>

        <nav className="desktop-navigation" aria-label={content.header.primaryNavLabel}>
          {content.header.navLinks.map((link) => (
            <a key={link.href} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <a className="header-action" href="#install">
          {content.site.primaryAction}
          <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
        </a>

        <details
          className="mobile-menu"
          ref={menuRef}
          onToggle={(event) => setMenuOpen(event.currentTarget.open)}
        >
          <summary
            aria-label={menuOpen ? content.header.mobileCloseLabel : content.header.mobileOpenLabel}
            aria-controls="mobile-navigation"
            aria-expanded={menuOpen}
          >
            <Menu size={18} aria-hidden="true" />
            <span>{content.header.mobileMenuLabel}</span>
            <ChevronDown className="menu-chevron" size={15} aria-hidden="true" />
          </summary>
          <nav id="mobile-navigation" aria-label={content.header.mobileNavLabel}>
            {content.header.navLinks.map((link) => (
              <a key={link.href} href={link.href} onClick={closeMenu}>
                {link.label}
              </a>
            ))}
            <span className="mobile-menu-footnote">
              <X size={14} aria-hidden="true" /> {content.header.mobileFootnote}
            </span>
          </nav>
        </details>
      </div>
    </header>
  );
}
