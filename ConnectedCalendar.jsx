import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { RefreshCw, Link2, Unlink, CalendarCheck, AlertCircle } from "lucide-react";

const CONNECTOR_ID = "6a91553ad4b14f3bb5b6dc98";

export default function ConnectedCalendars({ onConnectedChange, onSynced }) {
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState(null);

  const setStatus = (v) => {
    setConnected(v);
    onConnectedChange?.(v);
  };

  const checkStatus = async () => {
    try {
      const res = await base44.functions.invoke("syncGoogleCalendar", { mode: "status" });
      setStatus(!!res.data?.connected);
    } catch {
      setStatus(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const url = await base44.connectors.connectAppUser(CONNECTOR_ID);
      const popup = window.open(url, "_blank");
      const timer = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          (async () => {
            await checkStatus();
            await doSync();
          })();
        }
      }, 600);
    } catch (e) {
      console.error(e);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await base44.connectors.disconnectAppUser(CONNECTOR_ID);
      setStatus(false);
      setResult(null);
      onSynced?.();
    } catch (e) {
      console.error(e);
    }
  };

  const doSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke("syncGoogleCalendar", { mode: "pull" });
      setResult(res.data);
      onSynced?.();
    } catch (e) {
      setResult({ error: "Sync failed — try reconnecting." });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="rounded-3xl bg-white border border-stone-200/70 p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sky-600 mb-3">
        <CalendarCheck className="w-4 h-4" />
        <span className="text-xs font-bold uppercase tracking-wider">Connected calendars</span>
      </div>

      {!connected ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-stone-500">Connect Google Calendar to merge its events into your family calendar — and sync new events both ways.</p>
          <Button onClick={handleConnect} disabled={connecting} className="bg-sky-600 hover:bg-sky-700 shrink-0 gap-1.5">
            <Link2 className="w-4 h-4" />
            {connecting ? "Connecting…" : "Connect Google Calendar"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-semibold text-stone-700">Google Calendar connected</span>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={doSync} disabled={syncing} variant="outline" size="sm" className="gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button onClick={handleDisconnect} variant="ghost" size="sm" className="gap-1.5 text-stone-500 hover:text-red-500">
                <Unlink className="w-3.5 h-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
          {result && !result.error && (
            <p className="text-xs text-emerald-600 flex items-center gap-1.5">
              <CalendarCheck className="w-3.5 h-3.5" />
              Synced — {result.created || 0} new, {result.updated || 0} updated, {result.removed || 0} removed.
            </p>
          )}
          {result?.error && (
            <p className="text-xs text-red-500 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {result.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
