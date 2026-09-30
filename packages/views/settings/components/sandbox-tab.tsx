"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Box, PlugZap, Trash2 } from "lucide-react";
import { Button } from "@quickwork/ui/components/ui/button";
import { Card, CardContent } from "@quickwork/ui/components/ui/card";
import { Input } from "@quickwork/ui/components/ui/input";
import { Label } from "@quickwork/ui/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quickwork/ui/components/ui/alert-dialog";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { sandboxConnectionOptions } from "@quickwork/core/sandbox";
import { api } from "@quickwork/core/api";
import { useT } from "../../i18n";

/** The public E2B cloud. Self-hosted and BYOC deployments point elsewhere. */
const DEFAULT_API_URL = "https://api.e2b.app";

/**
 * Matches the server's sentinel: an empty key field on an existing connection
 * means "keep the stored one" rather than "erase it".
 */
const KEEP_STORED_KEY = "****";

export function SandboxTab() {
  const { t } = useT("settings");
  const wsId = useWorkspaceId();
  const qc = useQueryClient();

  const { data } = useQuery(sandboxConnectionOptions(wsId));
  const configured = data?.configured === true;
  const canManage = data?.can_manage === true;

  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // A saved connection is a working one (the server probes before storing),
  // so the form starts collapsed and only opens for an explicit update.
  const showForm = canManage && (!configured || editing);
  const effectiveApiUrl = apiUrl.trim() || data?.api_url || DEFAULT_API_URL;

  async function handleSave() {
    if (saving) return;
    if (!configured && !apiKey.trim()) return;
    setSaving(true);
    try {
      await api.putSandboxConnection(wsId, {
        api_url: effectiveApiUrl,
        api_key: apiKey.trim() || KEEP_STORED_KEY,
      });
      await qc.invalidateQueries({ queryKey: ["sandbox", wsId] });
      setApiKey("");
      setApiUrl("");
      setEditing(false);
      toast.success(t(($) => $.sandbox.toast_connected));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.sandbox.toast_connect_failed));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    try {
      const resp = await api.testSandboxConnection(wsId, {
        api_url: effectiveApiUrl,
        api_key: apiKey.trim() || KEEP_STORED_KEY,
      });
      toast.success(t(($) => $.sandbox.toast_test_ok, { count: resp.sandbox_count }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.sandbox.toast_test_failed));
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      await api.deleteSandboxConnection(wsId);
      await qc.invalidateQueries({ queryKey: ["sandbox", wsId] });
      setConfirmDisconnect(false);
      setEditing(false);
      toast.success(t(($) => $.sandbox.toast_disconnected));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t(($) => $.sandbox.toast_disconnect_failed));
    } finally {
      setDisconnecting(false);
    }
  }

  // The server has no QUICKWORK_SANDBOX_SECRET_KEY: a form here could only ever
  // answer 503, so the section stays hidden rather than taunting the operator.
  if (data && data.available === false) return null;

  return (
    <div className="space-y-6">
      <p className="text-body text-muted-foreground">{t(($) => $.sandbox.page_description)}</p>

      {configured && (
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-md border bg-muted/50 p-2 text-muted-foreground shrink-0">
                <Box className="h-4 w-4" />
              </div>
              <div className="min-w-0 space-y-0.5">
                <p className="text-body font-medium break-all">
                  {data?.api_url ?? DEFAULT_API_URL}
                </p>
                <p className="text-caption text-muted-foreground">
                  {data?.verified_at
                    ? t(($) => $.sandbox.verified_at, {
                        time: new Date(data.verified_at).toLocaleString(),
                      })
                    : t(($) => $.sandbox.connected_unverified)}
                </p>
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
                  <PlugZap className="h-3 w-3" />
                  {testing ? t(($) => $.sandbox.testing) : t(($) => $.sandbox.test)}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)}>
                  <Trash2 className="h-3 w-3" />
                  {t(($) => $.sandbox.disconnect)}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardContent className="space-y-4">
            <p className="text-body font-medium">
              {configured ? t(($) => $.sandbox.update_title) : t(($) => $.sandbox.connect_title)}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="sandbox-api-url">{t(($) => $.sandbox.form_api_url_label)}</Label>
              <Input
                id="sandbox-api-url"
                placeholder={DEFAULT_API_URL}
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                disabled={saving}
              />
              <p className="text-caption text-muted-foreground">
                {t(($) => $.sandbox.form_api_url_hint)}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sandbox-api-key">{t(($) => $.sandbox.form_api_key_label)}</Label>
              <Input
                id="sandbox-api-key"
                type="password"
                placeholder={
                  configured
                    ? t(($) => $.sandbox.form_api_key_placeholder_keep)
                    : t(($) => $.sandbox.form_api_key_placeholder)
                }
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={saving}
              />
              <p className="text-caption text-muted-foreground">
                {configured
                  ? t(($) => $.sandbox.form_api_key_hint_keep)
                  : t(($) => $.sandbox.form_api_key_hint)}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              {configured && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setApiKey("");
                    setApiUrl("");
                  }}
                  disabled={saving}
                >
                  {t(($) => $.sandbox.cancel)}
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || (!configured && !apiKey.trim())}
              >
                {saving
                  ? t(($) => $.sandbox.connecting)
                  : configured
                    ? t(($) => $.sandbox.save)
                    : t(($) => $.sandbox.connect)}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {configured && canManage && !editing && (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          {t(($) => $.sandbox.update_title)}
        </Button>
      )}

      {!canManage && !configured && (
        <p className="text-caption text-muted-foreground">{t(($) => $.sandbox.contact_admin)}</p>
      )}

      <AlertDialog
        open={confirmDisconnect}
        onOpenChange={(v) => {
          if (!v && !disconnecting) setConfirmDisconnect(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.sandbox.disconnect_confirm_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.sandbox.disconnect_confirm_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              {t(($) => $.sandbox.disconnect_confirm_cancel)}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting
                ? t(($) => $.sandbox.disconnecting)
                : t(($) => $.sandbox.disconnect_confirm_action)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
