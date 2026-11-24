import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  Columns2,
  Copy,
  Eye,
  GripVertical,
  Minus,
  Plus,
  RefreshCw,
  Rows3,
  Users,
  X,
  Zap,
} from "lucide-react";
import { SquadSyncClient, SyncStatus, SyncWirePayload } from "./squadSync";
import { EnemyTimerRow, InitialPayload, LiveMatchState, TimerAppSettings } from "./types";

interface ActiveTimer {
  endEpochMs: number;
  totalSecs: number;
  minusFlashUntilMs: number;
  syncFlashUntilMs: number;
  remoteStartedAtMs: number;
}

type TimerSlotKey = "D" | "F" | "R";
type OverlayScale = "S" | "M" | "L";

const SCALE_METRICS: Record<
  OverlayScale,
  {
    iconPx: number;
    avatarPx: number;
    cdText: string;
    posText: string;
    gapPx: number;
  }
> = {
  S: {
    iconPx: 22,
    avatarPx: 22,
    cdText: "text-[9.5px]",
    posText: "text-[8px]",
    gapPx: 2,
  },
  M: {
    iconPx: 26,
    avatarPx: 26,
    cdText: "text-[10.5px]",
    posText: "text-[8.5px]",
    gapPx: 3,
  },
  L: {
    iconPx: 30,
    avatarPx: 30,
    cdText: "text-[11.5px]",
    posText: "text-[9px]",
    gapPx: 3,
  },
};

function calcCd(baseCd: number, haste: number): number {
  if (baseCd <= 0) return 0;
  return Math.round((baseCd * 100) / (100 + Math.max(0, haste)));
}

function formatGameClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

function formatShortRemaining(secs: number): string {
  if (secs >= 60) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  return `${secs}`;
}

function shortSpellLabel(spellId: string, nameVi: string): string {
  switch (spellId) {
    case "SummonerFlash":
      return "Flash";
    case "SummonerTeleport":
      return "TP";
    case "SummonerDot":
      return "Ignite";
    case "SummonerHaste":
      return "Ghost";
    case "SummonerExhaust":
      return "Exh";
    case "SummonerBarrier":
      return "Bar";
    case "SummonerBoost":
      return "Cleanse";
    case "SummonerHeal":
      return "Heal";
    case "SummonerSmite":
      return "Smite";
    default:
      return nameVi;
  }
}

function getEnemySyncKey(enemies: EnemyTimerRow[], enemy: EnemyTimerRow): string {
  const idLower = enemy.championId.toLowerCase();
  let occ = 0;
  for (const e of enemies) {
    if (e.slotIndex === enemy.slotIndex) break;
    if (e.championId.toLowerCase() === idLower) occ += 1;
  }
  return `${idLower}#${occ}`;
}

function findEnemyBySyncKey(
  enemies: EnemyTimerRow[],
  enemyKey: string
): EnemyTimerRow | undefined {
  for (const e of enemies) {
    if (getEnemySyncKey(enemies, e) === enemyKey) return e;
  }
  return undefined;
}

function parseTargetSlot(
  enemies: EnemyTimerRow[],
  target: string
): { enemy: EnemyTimerRow; slot: TimerSlotKey } | null {
  const idx = target.lastIndexOf(":");
  if (idx <= 0) return null;
  const enemyKey = target.slice(0, idx);
  const slot = target.slice(idx + 1) as TimerSlotKey;
  if (slot !== "D" && slot !== "F" && slot !== "R") return null;
  const enemy = findEnemyBySyncKey(enemies, enemyKey);
  if (!enemy) return null;
  return { enemy, slot };
}

function App() {
  const [matchState, setMatchState] = useState<LiveMatchState | null>(null);
  const [layout, setLayout] = useState<"vertical" | "horizontal">("vertical");
  const [scale, setScale] = useState<OverlayScale>("S");
  const [collapsed, setCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.9);
  const [timers, setTimers] = useState<Record<string, ActiveTimer>>({});
  const [cosmicOverrides, setCosmicOverrides] = useState<Record<number, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [squadCode, setSquadCode] = useState("");
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ connected: false, peerCount: 0 });
  const [syncNotice, setSyncNotice] = useState("");

  const boxRef = useRef<HTMLDivElement | null>(null);
  const lastFitRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const prevInGameRef = useRef<boolean | null>(null);
  const prevGameTimeRef = useRef<number>(0);
  const lastSyncRef = useRef<{ gameTimeSecs: number; atEpochMs: number }>({
    gameTimeSecs: 0,
    atEpochMs: Date.now(),
  });
  const draggingRef = useRef(false);
  const timersRef = useRef(timers);
  timersRef.current = timers;
  const cosmicRef = useRef(cosmicOverrides);
  cosmicRef.current = cosmicOverrides;
  const matchStateRef = useRef(matchState);
  matchStateRef.current = matchState;
  const syncClientRef = useRef<SquadSyncClient | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const flashSyncNotice = (msg: string) => {
    setSyncNotice(msg);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setSyncNotice("");
      noticeTimerRef.current = null;
    }, 1400);
  };

  useEffect(() => {
    invoke<InitialPayload>("cmd_get_initial_state").then((payload) => {
      setMatchState(payload.matchState);
      const l = payload.settings.layout === "horizontal" ? "horizontal" : "vertical";
      const s =
        payload.settings.scale === "M" || payload.settings.scale === "L"
          ? payload.settings.scale
          : "S";
      setLayout(l);
      setScale(s);
      setOpacity(payload.settings.opacity || 0.9);
      setSyncEnabled(payload.settings.syncEnabled ?? true);
      setSquadCode((payload.settings.squadCode || "").toUpperCase());
      prevInGameRef.current = payload.matchState.inGame;
      lastSyncRef.current = {
        gameTimeSecs: payload.matchState.gameTimeSecs,
        atEpochMs: Date.now(),
      };
    });

    const unlisten = listen<LiveMatchState>("match-state-updated", (event) => {
      const next = event.payload;
      lastSyncRef.current = {
        gameTimeSecs: next.gameTimeSecs,
        atEpochMs: Date.now(),
      };
      if (
        prevInGameRef.current !== null &&
        (prevInGameRef.current !== next.inGame ||
          (next.inGame && next.gameTimeSecs + 15 < prevGameTimeRef.current))
      ) {
        setTimers({});
        setCosmicOverrides({});
      }
      prevInGameRef.current = next.inGame;
      prevGameTimeRef.current = next.gameTimeSecs;
      setMatchState(next);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const inLiveAutoMatch = Boolean(
    matchState?.inGame && !matchState.isDemo && matchState.autoSyncRoom
  );
  const activeRoomKey = useMemo(() => {
    if (!syncEnabled) return null;
    if (inLiveAutoMatch && matchState?.autoSyncRoom) {
      return `auto_${matchState.autoSyncRoom}`;
    }
    if (squadCode) {
      return `squad_${squadCode.toUpperCase()}`;
    }
    return null;
  }, [syncEnabled, inLiveAutoMatch, matchState?.autoSyncRoom, squadCode]);

  useEffect(() => {
    if (!activeRoomKey) {
      syncClientRef.current = null;
      setSyncStatus({ connected: false, peerCount: 0 });
      return;
    }

    const client = new SquadSyncClient(
      activeRoomKey,
      (msg: SyncWirePayload) => {
        const ms = matchStateRef.current;
        if (!ms) return;
        const cur = Date.now();

        if (msg.op === "set") {
          const parsed = parseTargetSlot(ms.enemies, msg.target);
          if (!parsed) return;
          if (msg.remainingMs <= 500) return;
          const key = `${parsed.enemy.slotIndex}-${parsed.slot}`;
          setTimers((prev) => ({
            ...prev,
            [key]: {
              endEpochMs: cur + msg.remainingMs,
              totalSecs: msg.totalSecs,
              minusFlashUntilMs: msg.isMinus5 ? cur + 650 : 0,
              syncFlashUntilMs: cur + 900,
              remoteStartedAtMs: msg.isStart ? cur : 0,
            },
          }));
        } else if (msg.op === "reset") {
          const parsed = parseTargetSlot(ms.enemies, msg.target);
          if (!parsed) return;
          const key = `${parsed.enemy.slotIndex}-${parsed.slot}`;
          setTimers((prev) => {
            if (!prev[key]) return prev;
            const copy = { ...prev };
            delete copy[key];
            return copy;
          });
        } else if (msg.op === "cosmic") {
          const enemy = findEnemyBySyncKey(ms.enemies, msg.enemyKey);
          if (!enemy) return;
          setCosmicOverrides((prev) => ({
            ...prev,
            [enemy.slotIndex]: msg.enabled,
          }));
        } else if (msg.op === "snapshot") {
          if (msg.timers.length > 0) {
            setTimers((prev) => {
              let changed = false;
              const next = { ...prev };
              for (const item of msg.timers) {
                if (item.remainingMs <= 1000) continue;
                const parsed = parseTargetSlot(ms.enemies, item.target);
                if (!parsed) continue;
                const key = `${parsed.enemy.slotIndex}-${parsed.slot}`;
                if (!next[key] || next[key].endEpochMs <= cur) {
                  next[key] = {
                    endEpochMs: cur + item.remainingMs,
                    totalSecs: item.totalSecs,
                    minusFlashUntilMs: 0,
                    syncFlashUntilMs: cur + 900,
                    remoteStartedAtMs: 0,
                  };
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
          }
          const cosmicEntries = Object.entries(msg.cosmic);
          if (cosmicEntries.length > 0) {
            setCosmicOverrides((prev) => {
              let changed = false;
              const next = { ...prev };
              for (const [enemyKey, enabled] of cosmicEntries) {
                const enemy = findEnemyBySyncKey(ms.enemies, enemyKey);
                if (!enemy) continue;
                if (next[enemy.slotIndex] === undefined) {
                  next[enemy.slotIndex] = enabled;
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
          }
        }
      },
      (status) => setSyncStatus(status),
      () => {
        const ms = matchStateRef.current;
        const cur = Date.now();
        const snapTimers: Array<{ target: string; remainingMs: number; totalSecs: number }> = [];
        const snapCosmic: Record<string, boolean> = {};
        if (ms) {
          for (const enemy of ms.enemies) {
            const eKey = getEnemySyncKey(ms.enemies, enemy);
            if (cosmicRef.current[enemy.slotIndex] !== undefined) {
              snapCosmic[eKey] = cosmicRef.current[enemy.slotIndex];
            }
            for (const slot of ["D", "F", "R"] as TimerSlotKey[]) {
              const t = timersRef.current[`${enemy.slotIndex}-${slot}`];
              if (t && t.endEpochMs > cur + 1000) {
                snapTimers.push({
                  target: `${eKey}:${slot}`,
                  remainingMs: t.endEpochMs - cur,
                  totalSecs: t.totalSecs,
                });
              }
            }
          }
        }
        return { timers: snapTimers, cosmic: snapCosmic };
      }
    );

    syncClientRef.current = client;
    return () => {
      syncClientRef.current = null;
      client.destroy();
    };
  }, [activeRoomKey]);

  // Auto-fit window using scrollWidth/scrollHeight so edges are never clipped
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const fit = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.max(Math.ceil(rect.width), Math.ceil(el.scrollWidth));
      const h = Math.max(Math.ceil(rect.height), Math.ceil(el.scrollHeight));
      if (
        w > 20 &&
        h > 16 &&
        (Math.abs(w - lastFitRef.current.w) >= 2 ||
          Math.abs(h - lastFitRef.current.h) >= 2)
      ) {
        lastFitRef.current = { w, h };
        invoke("cmd_fit_window_size", { width: w, height: h });
      }
    };

    fit();
    const timer = window.setTimeout(fit, 120);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [matchState, layout, scale, collapsed, showSyncPanel]);

  // 250ms tick for crisp countdown & auto-cleanup
  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = Date.now();
      setNowMs(cur);
      setTimers((prev) => {
        let changed = false;
        const next: Record<string, ActiveTimer> = {};
        for (const [k, t] of Object.entries(prev)) {
          if (t.endEpochMs > cur) {
            next[k] = t;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // Native Win32 dragging so WS_EX_NOACTIVATE stays intact
  useEffect(() => {
    const onMouseMove = () => {
      if (draggingRef.current) {
        invoke("cmd_update_drag");
      }
    };
    const onMouseUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        invoke("cmd_end_drag");
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const currentEstimatedGameSecs = useMemo(() => {
    if (!matchState?.inGame) return 0;
    const elapsed = (nowMs - lastSyncRef.current.atEpochMs) / 1000;
    return lastSyncRef.current.gameTimeSecs + Math.max(0, elapsed);
  }, [matchState?.inGame, nowMs]);

  const isCosmicEnabled = (enemy: EnemyTimerRow): boolean => {
    if (cosmicOverrides[enemy.slotIndex] !== undefined) {
      return cosmicOverrides[enemy.slotIndex];
    }
    return enemy.hasInspirationRune;
  };

  const getEffectiveSpellCd = (enemy: EnemyTimerRow, slot: TimerSlotKey): number => {
    if (slot === "R") {
      return enemy.ult.effectiveCd;
    }
    const baseCd = slot === "D" ? enemy.spellD.baseCd : enemy.spellF.baseCd;
    const totalHaste = enemy.bootsSpellHaste + (isCosmicEnabled(enemy) ? 18 : 0);
    return calcCd(baseCd, totalHaste);
  };

  const handleTimerClick = (enemy: EnemyTimerRow, slot: TimerSlotKey) => {
    const key = `${enemy.slotIndex}-${slot}`;
    const effCd = getEffectiveSpellCd(enemy, slot);
    const cur = Date.now();
    const ms = matchStateRef.current;
    const target = ms ? `${getEnemySyncKey(ms.enemies, enemy)}:${slot}` : "";

    const existing = timersRef.current[key];
    // Collision guard: teammate just started this timer (< 2.5s ago), confirm without subtracting -5s
    if (
      existing &&
      existing.endEpochMs > cur &&
      existing.remoteStartedAtMs > 0 &&
      cur - existing.remoteStartedAtMs < 2500
    ) {
      setTimers((prev) => {
        const current = prev[key];
        if (!current) return prev;
        return {
          ...prev,
          [key]: { ...current, remoteStartedAtMs: 0 },
        };
      });
      return;
    }

    if (!existing || existing.endEpochMs <= cur) {
      const remainingMs = effCd * 1000;
      setTimers((prev) => ({
        ...prev,
        [key]: {
          endEpochMs: cur + remainingMs,
          totalSecs: effCd,
          minusFlashUntilMs: 0,
          syncFlashUntilMs: 0,
          remoteStartedAtMs: 0,
        },
      }));
      if (target) {
        syncClientRef.current?.send({
          op: "set",
          target,
          remainingMs,
          totalSecs: effCd,
          isStart: true,
          isMinus5: false,
        });
      }
      return;
    }

    const nextEnd = existing.endEpochMs - 5000;
    if (nextEnd <= cur) {
      setTimers((prev) => {
        if (!prev[key]) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      if (target) {
        syncClientRef.current?.send({ op: "reset", target });
      }
      return;
    }

    const remainingMs = nextEnd - cur;
    setTimers((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return {
        ...prev,
        [key]: {
          ...current,
          endEpochMs: nextEnd,
          minusFlashUntilMs: cur + 650,
          remoteStartedAtMs: 0,
        },
      };
    });
    if (target) {
      syncClientRef.current?.send({
        op: "set",
        target,
        remainingMs,
        totalSecs: existing.totalSecs,
        isStart: false,
        isMinus5: true,
      });
    }
  };

  const handleTimerRightClick = (
    e: React.MouseEvent,
    enemy: EnemyTimerRow,
    slot: TimerSlotKey
  ) => {
    e.preventDefault();
    const key = `${enemy.slotIndex}-${slot}`;
    const hadTimer = Boolean(timersRef.current[key]);
    setTimers((prev) => {
      if (!prev[key]) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    if (hadTimer && matchStateRef.current) {
      const target = `${getEnemySyncKey(matchStateRef.current.enemies, enemy)}:${slot}`;
      syncClientRef.current?.send({ op: "reset", target });
    }
  };

  const handleToggleCosmic = (enemy: EnemyTimerRow) => {
    const nextVal = !isCosmicEnabled(enemy);
    setCosmicOverrides((prev) => ({
      ...prev,
      [enemy.slotIndex]: nextVal,
    }));
    if (matchStateRef.current) {
      const enemyKey = getEnemySyncKey(matchStateRef.current.enemies, enemy);
      syncClientRef.current?.send({
        op: "cosmic",
        enemyKey,
        enabled: nextVal,
      });
    }
  };

  const handleToggleSyncEnabled = async () => {
    const next = !syncEnabled;
    setSyncEnabled(next);
    const saved = await invoke<TimerAppSettings>("cmd_save_sync_settings", {
      syncEnabled: next,
      squadCode,
    });
    setSyncEnabled(saved.syncEnabled ?? next);
    if (saved.squadCode) setSquadCode(saved.squadCode.toUpperCase());
  };

  const handleCopySquadCode = async () => {
    if (!squadCode) return;
    await invoke("cmd_copy_text", { text: squadCode });
    flashSyncNotice("Đã copy!");
  };

  const handlePasteSquadCode = async () => {
    try {
      const raw = await invoke<string>("cmd_read_clipboard");
      const cleaned = raw
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);
      if (cleaned.length < 4) {
        flashSyncNotice("Mã lỗi!");
        return;
      }
      const saved = await invoke<TimerAppSettings>("cmd_save_sync_settings", {
        syncEnabled: true,
        squadCode: cleaned,
      });
      setSyncEnabled(saved.syncEnabled ?? true);
      setSquadCode((saved.squadCode || cleaned).toUpperCase());
      flashSyncNotice("Đã nối!");
    } catch {
      flashSyncNotice("Mã lỗi!");
    }
  };

  const handleRegenerateSquadCode = async () => {
    const saved = await invoke<TimerAppSettings>("cmd_save_sync_settings", {
      syncEnabled: true,
      squadCode: "NEW",
    });
    setSyncEnabled(saved.syncEnabled ?? true);
    if (saved.squadCode) {
      const code = saved.squadCode.toUpperCase();
      setSquadCode(code);
      await invoke("cmd_copy_text", { text: code });
      flashSyncNotice("Mã mới!");
    }
  };

  const handleCopyTimers = async () => {
    if (!matchState) return;
    const cur = Date.now();
    const parts: string[] = [];

    for (const enemy of matchState.enemies) {
      for (const slot of ["D", "F", "R"] as TimerSlotKey[]) {
        const t = timers[`${enemy.slotIndex}-${slot}`];
        if (!t || t.endEpochMs <= cur) continue;
        const remSecs = (t.endEpochMs - cur) / 1000;
        const label =
          slot === "R"
            ? "R"
            : slot === "D"
            ? shortSpellLabel(enemy.spellD.id, enemy.spellD.nameVi)
            : shortSpellLabel(enemy.spellF.id, enemy.spellF.nameVi);
        const readyAt = matchState.inGame
          ? formatGameClock(currentEstimatedGameSecs + remSecs)
          : `${Math.ceil(remSecs)}s`;
        parts.push(`${enemy.position} ${label} ${readyAt}`);
      }
    }

    const out =
      parts.length > 0
        ? parts.join(" | ")
        : "Chưa có phép hoặc chiêu cuối nào đang đếm.";
    await invoke("cmd_copy_text", { text: out });
    setCopiedNotice(true);
    window.setTimeout(() => setCopiedNotice(false), 1500);
  };

  const toggleLayout = async () => {
    const next = layout === "vertical" ? "horizontal" : "vertical";
    setLayout(next);
    setCollapsed(false);
    await invoke("cmd_set_layout_and_collapse", { layout: next, collapsed: false });
  };

  const cycleScale = async () => {
    const next: OverlayScale = scale === "S" ? "M" : scale === "M" ? "L" : "S";
    setScale(next);
    await invoke("cmd_save_scale", { scale: next });
  };

  const toggleCollapse = async () => {
    const next = !collapsed;
    setCollapsed(next);
    await invoke("cmd_set_layout_and_collapse", { layout, collapsed: next });
  };

  const cycleOpacity = async () => {
    const next = opacity > 0.85 ? 0.72 : opacity > 0.62 ? 0.52 : 0.95;
    setOpacity(next);
    await invoke("cmd_save_opacity", { opacity: next });
  };

  const m = SCALE_METRICS[scale];

  const renderSlotButton = (enemy: EnemyTimerRow, slot: TimerSlotKey) => {
    const key = `${enemy.slotIndex}-${slot}`;
    const active = timers[key];
    const remaining = active ? Math.max(0, Math.ceil((active.endEpochMs - nowMs) / 1000)) : 0;
    const isUrgent = remaining > 0 && remaining <= 10;
    const showMinus5 = active && active.minusFlashUntilMs > nowMs;
    const isSyncFlashing = Boolean(active && active.syncFlashUntilMs > nowMs);
    const effCd = getEffectiveSpellCd(enemy, slot);

    const iconUrl =
      slot === "D"
        ? enemy.spellD.iconUrl
        : slot === "F"
        ? enemy.spellF.iconUrl
        : enemy.ult.iconUrl;
    const fallbackLabel = slot === "R" ? "R" : slot;
    const tooltip =
      slot === "D"
        ? `${enemy.championName} • ${enemy.spellD.nameVi} (${effCd}s) | Trái: Đếm/-5s | Phải: Reset`
        : slot === "F"
        ? `${enemy.championName} • ${enemy.spellF.nameVi} (${effCd}s) | Trái: Đếm/-5s | Phải: Reset`
        : `${enemy.championName} • ${enemy.ult.name} (${effCd}s) | Trái: Đếm/-5s | Phải: Reset`;

    return (
      <button
        key={slot}
        type="button"
        title={tooltip}
        onClick={() => handleTimerClick(enemy, slot)}
        onContextMenu={(e) => handleTimerRightClick(e, enemy, slot)}
        style={{ width: m.iconPx, height: m.iconPx }}
        className={`relative rounded-[3px] overflow-hidden border shadow-[0_1px_4px_rgba(0,0,0,0.95)] transition-transform active:scale-95 shrink-0 ${
          isSyncFlashing ? "ring-1 ring-[#0AC8B9] " : ""
        }${
          isUrgent
            ? "timer-urgent border-[#E84057]"
            : remaining > 0
            ? "border-[#C8AA6E]"
            : slot === "R"
            ? "border-[#0AC8B9]/80 hover:border-[#0AC8B9]"
            : "border-[#C8AA6E]/60 hover:border-[#F0E6D2]"
        } bg-[#010A13]`}
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={fallbackLabel}
            className={`w-full h-full object-cover ${
              remaining > 0 ? "brightness-[0.28] grayscale-[45%]" : "brightness-100"
            }`}
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] font-bold text-[#C8AA6E]">
            {fallbackLabel}
          </div>
        )}

        {remaining > 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={`font-black leading-none tracking-tighter ${m.cdText} ${
                isUrgent ? "text-[#FF6B7F]" : "text-[#F0E6D2]"
              }`}
              style={{ textShadow: "0 1px 2px #000, 0 0 3px #000" }}
            >
              {formatShortRemaining(remaining)}
            </span>
          </div>
        )}

        {showMinus5 && (
          <span className="absolute -top-0.5 right-0 text-[7px] font-black text-[#0AC8B9]">
            -5
          </span>
        )}
      </button>
    );
  };

  if (!matchState) {
    return null;
  }

  return (
    <div
      ref={boxRef}
      className="inline-flex flex-col items-start p-1 gap-1 bg-transparent select-none group"
      style={{ opacity }}
    >
      {/* Floating Transparent Pill Toolbar */}
      <div className="rounded-full bg-[#06101E]/75 border border-[#C8AA6E]/35 px-1.5 h-[18px] whitespace-nowrap inline-flex items-center gap-1 shadow-[0_1px_4px_rgba(0,0,0,0.85)] opacity-55 group-hover:opacity-100 transition-opacity">
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            invoke("cmd_begin_drag");
          }}
          className="inline-flex items-center gap-0.5 cursor-move py-0.5"
          title="Kéo thả để đặt vị trí"
        >
          <GripVertical className="w-2.5 h-2.5 text-[#C8AA6E] shrink-0" />
          <span
            className={`text-[9px] font-bold leading-none ${
              matchState.inGame ? "text-[#0AC8B9]" : "text-[#C8AA6E]"
            }`}
          >
            {matchState.inGame ? formatGameClock(currentEstimatedGameSecs) : "DEMO"}
          </span>
        </div>

        <div className="inline-flex items-center gap-[1px] shrink-0">
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={handleCopyTimers}
                title="Copy mốc giờ hồi vào Clipboard"
                className="p-0.5 rounded hover:bg-[#C8AA6E]/20 text-[#C8AA6E]"
              >
                {copiedNotice ? (
                  <Check className="w-2.5 h-2.5 text-[#0AC8B9]" />
                ) : (
                  <Copy className="w-2.5 h-2.5" />
                )}
              </button>

              <button
                type="button"
                onClick={cycleScale}
                title={`Đổi kích cỡ (Hiện tại: ${scale})`}
                className="px-0.5 text-[8px] font-black leading-none text-[#F0E6D2] hover:text-[#0AC8B9] rounded hover:bg-[#C8AA6E]/20"
              >
                {scale}
              </button>

              <button
                type="button"
                onClick={toggleLayout}
                title={layout === "vertical" ? "Đổi sang Ngang" : "Đổi sang Dọc"}
                className="p-0.5 rounded hover:bg-[#C8AA6E]/20 text-[#C8AA6E]"
              >
                {layout === "vertical" ? (
                  <Columns2 className="w-2.5 h-2.5" />
                ) : (
                  <Rows3 className="w-2.5 h-2.5" />
                )}
              </button>

              <button
                type="button"
                onClick={cycleOpacity}
                title={`Độ mờ: ${Math.round(opacity * 100)}%`}
                className="p-0.5 rounded hover:bg-[#C8AA6E]/20 text-[#A09B8C] hover:text-[#F0E6D2]"
              >
                <Eye className="w-2.5 h-2.5" />
              </button>

              <button
                type="button"
                onClick={() => setShowSyncPanel((v) => !v)}
                title={
                  !syncEnabled
                    ? "Đồng bộ tổ đội: Đang TẮT"
                    : syncStatus.peerCount > 0
                    ? `Đang đồng bộ cùng ${syncStatus.peerCount} đồng đội`
                    : syncStatus.connected
                    ? "Đồng bộ tổ đội: Sẵn sàng"
                    : "Đồng bộ tổ đội: Đang kết nối..."
                }
                className={`p-0.5 rounded hover:bg-[#C8AA6E]/20 inline-flex items-center gap-[1px] ${
                  !syncEnabled
                    ? "text-[#A09B8C]/45"
                    : syncStatus.peerCount > 0
                    ? "text-[#0AC8B9]"
                    : syncStatus.connected
                    ? "text-[#C8AA6E]"
                    : "text-[#A09B8C]/60"
                }`}
              >
                <Users className="w-2.5 h-2.5" />
                {syncEnabled && syncStatus.peerCount > 0 && (
                  <span className="text-[7.5px] font-black leading-none">
                    {syncStatus.peerCount + 1}
                  </span>
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={toggleCollapse}
            title={collapsed ? "Mở rộng" : "Thu gọn"}
            className="p-0.5 rounded hover:bg-[#C8AA6E]/20 text-[#C8AA6E]"
          >
            {collapsed ? <Plus className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
          </button>

          <button
            type="button"
            onClick={() => invoke("cmd_quit_timer")}
            title="Đóng"
            className="p-0.5 rounded hover:bg-[#E84057]/25 text-[#A09B8C] hover:text-[#E84057]"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Compact Squad Sync Bar */}
      {showSyncPanel && !collapsed && (
        <div className="rounded bg-[#06101E]/90 border border-[#C8AA6E]/45 px-1.5 h-[20px] whitespace-nowrap inline-flex items-center gap-1 shadow-[0_2px_6px_rgba(0,0,0,0.9)] text-[8.5px]">
          <button
            type="button"
            onClick={handleToggleSyncEnabled}
            title={syncEnabled ? "Bấm để tắt đồng bộ" : "Bấm để bật đồng bộ"}
            className={`px-1 rounded font-black leading-tight ${
              syncEnabled
                ? "bg-[#0AC8B9]/20 text-[#0AC8B9]"
                : "bg-[#A09B8C]/15 text-[#A09B8C]"
            }`}
          >
            SYNC
          </button>

          {inLiveAutoMatch ? (
            <span className="text-[#F0E6D2] font-bold">
              AUTO •{" "}
              <span className="text-[#0AC8B9]">
                {syncStatus.peerCount > 0 ? `+${syncStatus.peerCount} bồ` : "Theo phe"}
              </span>
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCopySquadCode}
                title="Bấm copy mã phòng để gửi bạn bè ghép thử"
                className="font-mono font-bold text-[#F0E6D2] hover:text-[#0AC8B9] bg-[#C8AA6E]/15 px-1 rounded leading-tight"
              >
                {syncNotice || squadCode || "-----"}
              </button>
              <button
                type="button"
                onClick={handlePasteSquadCode}
                title="Copy mã từ bạn bè rồi bấm nút này để vào phòng"
                className="px-1 rounded bg-[#0AC8B9]/20 text-[#0AC8B9] hover:bg-[#0AC8B9]/35 font-bold leading-tight"
              >
                Dán
              </button>
              <button
                type="button"
                onClick={handleRegenerateSquadCode}
                title="Tạo mã phòng mới & copy"
                className="p-0.5 rounded hover:bg-[#C8AA6E]/20 text-[#C8AA6E]"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* Floating Transparent Icon Grid */}
      {!collapsed && (
        <div
          style={{ gap: layout === "horizontal" ? m.gapPx + 3 : m.gapPx }}
          className={layout === "horizontal" ? "flex items-center" : "flex flex-col"}
        >
          {matchState.enemies.map((enemy) => {
            const cosmic = isCosmicEnabled(enemy);

            if (layout === "horizontal") {
              return (
                <div
                  key={enemy.slotIndex}
                  style={{ gap: m.gapPx }}
                  className="flex flex-col items-center bg-[#040A14]/35 rounded px-[2px] py-[2px]"
                >
                  <div className="w-full flex items-center justify-between gap-1">
                    <div className="flex items-center gap-0.5">
                      {enemy.championIconUrl ? (
                        <img
                          src={enemy.championIconUrl}
                          alt={enemy.championName}
                          style={{ width: 14, height: 14 }}
                          className="rounded-full border border-[#C8AA6E]/80 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                          draggable={false}
                        />
                      ) : null}
                      <span
                        className={`${m.posText} font-bold text-[#F0E6D2] leading-none`}
                        style={{ textShadow: "0 1px 2px #000" }}
                      >
                        {enemy.position}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleCosmic(enemy)}
                      title={
                        cosmic
                          ? "Thấu Thị Vũ Trụ (+18 Haste Spell): ĐANG BẬT"
                          : "Bấm bật Thấu Thị Vũ Trụ (+18 Haste Spell)"
                      }
                      className={`p-[1px] rounded ${
                        cosmic ? "text-[#0AC8B9]" : "text-[#A09B8C]/60 hover:text-[#C8AA6E]"
                      }`}
                    >
                      <Zap className="w-2.5 h-2.5 drop-shadow" />
                    </button>
                  </div>
                  <div style={{ gap: m.gapPx }} className="flex items-center">
                    {renderSlotButton(enemy, "D")}
                    {renderSlotButton(enemy, "F")}
                    {renderSlotButton(enemy, "R")}
                  </div>
                </div>
              );
            }

            // Floating Vertical Row on transparent background
            return (
              <div
                key={enemy.slotIndex}
                style={{ gap: m.gapPx }}
                className="flex items-center"
              >
                <div
                  className="relative shrink-0"
                  title={`${enemy.championName} (${enemy.position}) • Cấp ${enemy.level}`}
                >
                  {enemy.championIconUrl ? (
                    <img
                      src={enemy.championIconUrl}
                      alt={enemy.championName}
                      style={{ width: m.avatarPx, height: m.avatarPx }}
                      className="rounded-full border border-[#C8AA6E]/90 object-cover shadow-[0_1px_4px_rgba(0,0,0,0.95)]"
                      draggable={false}
                    />
                  ) : (
                    <div
                      style={{ width: m.avatarPx, height: m.avatarPx }}
                      className="rounded-full bg-[#010A13] border border-[#C8AA6E]/90 text-[8px] flex items-center justify-center font-bold shadow-[0_1px_4px_rgba(0,0,0,0.95)]"
                    >
                      {enemy.position}
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 bg-[#010A13] border border-[#C8AA6E]/60 rounded-sm px-[2px] text-[7px] font-bold leading-none text-[#F0E6D2]">
                    {enemy.level}
                  </span>
                </div>

                {renderSlotButton(enemy, "D")}
                {renderSlotButton(enemy, "F")}
                {renderSlotButton(enemy, "R")}

                <button
                  type="button"
                  onClick={() => handleToggleCosmic(enemy)}
                  title={
                    cosmic
                      ? `${enemy.championName}: Đang bật Thấu Thị Vũ Trụ (+18 Haste Spell)`
                      : `${enemy.championName}: Bấm bật Thấu Thị Vũ Trụ (+18 Haste Spell)`
                  }
                  className={`p-[2px] rounded shrink-0 ${
                    cosmic
                      ? "bg-[#0AC8B9]/25 text-[#0AC8B9] shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
                      : "text-[#A09B8C]/60 hover:text-[#C8AA6E]"
                  }`}
                >
                  <Zap className="w-2.5 h-2.5 drop-shadow" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
