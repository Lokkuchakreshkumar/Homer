"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus, RotateCcw, Search } from "lucide-react";

import { content } from "@/data/content";
import {
  canReplay,
  canShowContext,
  demoFixtures,
  demoQueries,
  inferDemoQuery,
  initialDemoState,
  showsContext,
  statusForDemoState,
  transitionDemoState,
  visibleFixture,
  type DemoAction,
  type DemoState,
} from "@/lib/demo-state";

export function Demo() {
  const [state, setState] = useState<DemoState>(initialDemoState);
  const [isPulsing, setIsPulsing] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      if (pulseTimer.current) {
        clearTimeout(pulseTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (state.mode !== "reset") {
      return;
    }
    resetTimer.current = setTimeout(() => {
      setState(initialDemoState());
    }, 700);
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, [state.mode]);

  const dispatch = (action: DemoAction, pulse = true) => {
    setState((current) => transitionDemoState(current, action));
    const shouldPulse = action.type === "ask" || action.type === "context" || action.type === "replay";
    if (pulse && shouldPulse && !reduceMotion) {
      if (pulseTimer.current) {
        clearTimeout(pulseTimer.current);
      }
      setIsPulsing(true);
      pulseTimer.current = setTimeout(() => setIsPulsing(false), 460);
    }
  };

  const submitQuery = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      dispatch({ type: "invalid", text: value }, false);
      return;
    }
    const key = inferDemoQuery(trimmed);
    if (!key) {
      dispatch({ type: "unsupported", text: value }, false);
      return;
    }
    dispatch({ type: "ask", key, text: trimmed });
  };

  const fixture = visibleFixture(state);
  const hasContext = showsContext(state);
  const currentStatus = statusForDemoState(state);

  return (
    <div className={`demo-window demo-frame${isPulsing ? " is-pulsing" : ""}`}>
      <div className="demo-window-bar">
        <div className="window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="demo-window-title">{content.demo.labels.windowTitle}</span>
        <span className="local-badge">{content.demo.labels.noLiveRequest}</span>
      </div>

      <div className="demo-window-grid">
        <aside className="demo-controls" aria-label={content.demo.labels.controlsLabel}>
          <p className="eyebrow">{content.demo.labels.localSample}</p>
          <h3>{content.demo.title}</h3>
          <p className="demo-intro">{content.demo.body}</p>

          <form
            className="demo-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("query");
              submitQuery(input instanceof HTMLInputElement ? input.value : "");
            }}
          >
            <label htmlFor="demo-query">{content.demo.labels.inputLabel}</label>
            <div className="demo-input-row">
              <input
                id="demo-query"
                name="query"
                type="text"
                value={state.queryText}
                placeholder={content.demo.queries[0].text}
                autoComplete="off"
                required
                aria-invalid={state.queryError ? true : undefined}
                aria-describedby={`demo-query-suggestion${state.queryError ? " demo-query-error" : ""}`}
                onChange={(event) => {
                  dispatch({ type: "edit", text: event.target.value }, false);
                }}
              />
              <button className="button button-dark" type="submit">
                <Search size={16} aria-hidden="true" />
                {content.demo.labels.findAction}
              </button>
            </div>
            <p className="demo-suggestion" id="demo-query-suggestion">
              <span>{content.demo.labels.suggestedQuery}</span> {content.demo.queries[0].text}
            </p>
            {state.queryError ? (
              <p className="demo-input-error" id="demo-query-error" role="alert">
                {state.queryError}
              </p>
            ) : null}
          </form>

          <div className="demo-control-group sample-group">
            <fieldset className="sample-query-list">
              <legend className="visually-hidden">{content.demo.labels.approvedQueries}</legend>
              {demoQueries.map((query) => (
                <label className="query-chip" key={query.key}>
                  <input
                    type="radio"
                    name="approved-demo-query"
                    value={query.key}
                    checked={state.queryKey === query.key}
                    onChange={() => dispatch({ type: "ask", key: query.key })}
                  />
                  <span>{query.label}</span>
                </label>
              ))}
            </fieldset>
          </div>

          <div className="demo-control-group action-group">
            <p className="control-label">{content.demo.labels.exploreResult}</p>
            <div className="demo-action-list">
              <button
                className="button button-quiet"
                type="button"
                disabled={!canShowContext(state)}
                onClick={() => dispatch({ type: "context" })}
              >
                <Plus size={15} aria-hidden="true" />
                {content.demo.labels.showContext}
              </button>
              <button
                className="button button-quiet"
                type="button"
                disabled={!canReplay(state)}
                onClick={() => dispatch({ type: "replay" })}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {content.demo.labels.replay}
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => {
                  if (pulseTimer.current) {
                    clearTimeout(pulseTimer.current);
                  }
                  setIsPulsing(false);
                  dispatch({ type: "reset" }, false);
                }}
              >
                <RotateCcw size={15} aria-hidden="true" />
                {content.demo.labels.reset}
              </button>
            </div>
          </div>

          <div className="demo-status" role="status" aria-live="polite" aria-atomic="true">
            <span className="status-dot" aria-hidden="true" />
            <span>{currentStatus}</span>
          </div>
          <p className="demo-boundary">{content.demo.boundary}</p>
        </aside>

        <div className="demo-document-shell">
          <div className="sample-document" role="region" aria-label={content.demo.labels.documentLabel}>
            <div className="document-topline">
              <span>{content.demo.pageMeta}</span>
              <span>{content.demo.labels.illustrativeData}</span>
            </div>
            <div className="document-heading">
              <span className="document-stamp" aria-hidden="true">
                H
              </span>
              <div>
                <p className="document-kicker">{content.demo.labels.fieldSample}</p>
                <h3>{content.demo.pageTitle}</h3>
              </div>
            </div>
            <p className="document-intro">{content.demo.intro}</p>

            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key="document-results"
                className="document-results"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                transition={{ duration: reduceMotion ? 0 : 0.28, ease: "easeOut" }}
              >
                {demoFixtures.map((definition) => (
                  <p
                    className="document-paragraph result-answer"
                    key={definition.key}
                    hidden={fixture !== definition.key}
                  >
                    <span className="passage-label">{definition.answerLabel}</span>
                    {definition.answer.before}
                    <mark>{definition.answer.emphasis}</mark>
                    {definition.answer.after}
                  </p>
                ))}
                {demoFixtures.map((definition) => (
                  <p
                    className="document-paragraph context-paragraph"
                    key={definition.key}
                    hidden={!(hasContext && fixture === definition.key)}
                  >
                    <span className="passage-label">{definition.contextLabel}</span>
                    {definition.context}
                  </p>
                ))}
                <div
                  className="no-answer-card"
                  hidden={state.view !== "absent"}
                >
                  <strong>{content.demo.labels.noAnswerTitle}</strong>
                  <span>{content.demo.labels.noAnswerBody}</span>
                </div>
              </motion.div>
            </AnimatePresence>

            <p className="document-tail">{content.demo.labels.documentTail}</p>

            <div className="document-footer">
              <span>{content.demo.labels.currentPageExcerpt}</span>
              <span>{state.queryText || content.demo.labels.promptWhenEmpty}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
