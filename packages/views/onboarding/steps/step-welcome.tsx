"use client";

import { useState } from "react";
import { ArrowRight, Download, Loader2 } from "lucide-react";
import { DragStrip } from "@quickwork/views/platform";
import { useT } from "../../i18n";

/**
 * Step 0 — the welcome waybill.
 *
 * A dark dispatch stage on the left states the relay model; the waybill on the
 * right is the proof: one task leaves this zone, another zone's agent executes
 * it in a sandbox, and a receipt closes the loop. The whole screen is the
 * product's own vocabulary — zone, dispatch, receipt — rather than an abstract
 * onboarding carousel.
 *
 * Web keeps a secondary desktop-download action; desktop bundles its runtime,
 * so the same prompt would be noise there.
 */
export function StepWelcome({
  onNext,
  isWeb = false,
}: {
  onNext: () => void | Promise<void>;
  isWeb?: boolean;
}) {
  const { t } = useT("onboarding");
  const [pending, setPending] = useState(false);

  const handleNext = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onNext();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="qw-onb-welcome-wrap">
      <DragStrip />
      <div className="qw-onb-welcome">
        <div className="qw-onb-top">
          <span className="qw-onb-mark">Q</span>
          {t(($) => $.step_nav.wordmark)}
          <span className="qw-onb-progress">{t(($) => $.welcome.progress)}</span>
        </div>

        <div className="qw-onb-welcome-body">
          <div className="qw-onb-welcome-copy">
            <h1>
              {t(($) => $.welcome.headline_line1)}
              <br />
              <span>{t(($) => $.welcome.headline_line2)}</span>
            </h1>
            <p>{t(($) => $.welcome.lede)}</p>
            <div className="qw-onb-actions">
              <button
                type="button"
                className="qw-onb-primary"
                onClick={handleNext}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {isWeb
                  ? t(($) => $.welcome.continue_on_web)
                  : t(($) => $.welcome.start_exploring)}
                {!pending ? (
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                ) : null}
              </button>
              {isWeb ? (
                <a
                  href="/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="qw-onb-secondary"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  {t(($) => $.welcome.download_desktop)}
                </a>
              ) : null}
            </div>
            <p className="qw-onb-hint">
              {isWeb
                ? t(($) => $.welcome.lede_web)
                : t(($) => $.welcome.lede_desktop)}
            </p>
          </div>

          <aside className="qw-onb-waybill" aria-label={t(($) => $.welcome.waybill.title)}>
            <div className="qw-onb-wb-head">
              <span>{t(($) => $.welcome.waybill.title)}</span>
              <span>{t(($) => $.welcome.waybill.no)}</span>
            </div>
            <div className="qw-onb-wb-route">
              <div className="qw-onb-zone">
                <span className="k">{t(($) => $.welcome.waybill.origin_cap)}</span>
                <b>{t(($) => $.welcome.waybill.me)}</b>
                <span>{t(($) => $.welcome.waybill.me_sub)}</span>
              </div>
              <div className="qw-onb-route">
                <span>{t(($) => $.welcome.waybill.checkpoint_received)}</span>
                <i />
                <span>{t(($) => $.welcome.waybill.checkpoint_dispatched)}</span>
                <i />
                <span>{t(($) => $.welcome.waybill.checkpoint_running)}</span>
              </div>
              <div className="qw-onb-zone target">
                <span className="k">{t(($) => $.welcome.waybill.target_cap)}</span>
                <b>{t(($) => $.welcome.waybill.agent)}</b>
                <span>{t(($) => $.welcome.waybill.agent_sub)}</span>
              </div>
            </div>
            <div className="qw-onb-wb-grid">
              <div>
                <span>{t(($) => $.welcome.waybill.isolation)}</span>
                <b>{t(($) => $.welcome.waybill.sandbox)}</b>
              </div>
              <div>
                <span>{t(($) => $.welcome.waybill.receipt)}</span>
                <b className="stamp">{t(($) => $.welcome.waybill.stamp)}</b>
              </div>
              <div>
                <span>{t(($) => $.welcome.waybill.context)}</span>
                <b>{t(($) => $.welcome.waybill.context_value)}</b>
              </div>
            </div>
            <div className="qw-onb-wb-foot">
              {t(($) => $.welcome.waybill.footer)}
              <span className="sig">{t(($) => $.welcome.waybill.sig)}</span>
            </div>
          </aside>
        </div>

        <div className="qw-onb-foot">
          <span>{t(($) => $.welcome.waybill.step_welcome)}</span>
          <span className="line" />
          <span>{t(($) => $.welcome.waybill.step_workspace)}</span>
        </div>
      </div>
    </div>
  );
}
