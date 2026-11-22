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
  Rows3,
  X,
  Zap,
} from "lucide-react";
import { EnemyTimerRow, InitialPayload, LiveMatchState } from "./types";

interface ActiveTimer {
  endEpochMs: number;
  totalSecs: number;
  minusFlashUntilMs: number;
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
    padPx: number;
  }
> = {
  S: {
    iconPx: 22,
    avatarPx: 22,
    cdText: "text-[9.5px]",
    posText: "text-[8px]",
    gapPx: 2,
    padPx: 3,
  },
  M: {
    iconPx: 26,
    avatarPx: 26,
    cdText: "text-[10.5px]",
    posText: "text-[8.5px]",
    gapPx: 3,
    padPx: 4,
  },
  L: {
    iconPx: 30,
    avatarPx: 30,
    cdText: "text-[11.5px]",
    posText: "text-[9px]",
    gapPx: 3,
    padPx: 5,
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

function App() {
  const [matchState, setMatchState] = useState<LiveMatchState | null>(null);
  const [layout, setLayout] = useState<"vertical" | "horizontal">("vertical");
  const [scale, setScale] = useState<OverlayScale>("S");
  const [collapsed, setCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.85);
  const [timers, setTimers] = useState<Record<string, ActiveTimer>>({});
  const [cosmicOverrides, setCosmicOverrides] = useState<Record<number, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedNotice, setCopiedNotice] = useState(false);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const lastFitRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const prevInGameRef = useRef<boolean | null>(null);
  const prevGameTimeRef = useRef<number>(0);
  const lastSyncRef = useRef<{ gameTimeSecs: number; atEpochMs: number }>({
    gameTimeSecs: 0,
    atEpochMs: Date.now(),
  });
  const draggingRef = useRef(false);

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
      setOpacity(payload.settings.opacity || 0.85);
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

  // Auto-fit window strictly around the compact micro-overlay content
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const fit = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.ceil(rect.width);
      const h = Math.ceil(rect.height);
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
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [matchState, layout, scale, collapsed]);

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

    setTimers((prev) => {
      const existing = prev[key];
      if (!existing || existing.endEpochMs <= cur) {
        return {
          ...prev,
          [key]: {
            endEpochMs: cur + effCd * 1000,
            totalSecs: effCd,
            minusFlashUntilMs: 0,
          },
        };
      }
      const nextEnd = existing.endEpochMs - 5000;
      if (nextEnd <= cur) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return {
        ...prev,
        [key]: {
          ...existing,
          endEpochMs: nextEnd,
          minusFlashUntilMs: cur + 650,
        },
      };
    });
  };

  const handleTimerRightClick = (
    e: React.MouseEvent,
    enemy: EnemyTimerRow,
    slot: TimerSlotKey
  ) => {
    e.preventDefault();
    const key = `${enemy.slotIndex}-${slot}`;
    setTimers((prev) => {
      if (!prev[key]) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
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
    const next = opacity > 0.8 ? 0.68 : opacity > 0.58 ? 0.48 : 0.85;
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
        className={`relative rounded-[3px] overflow-hidden border transition-transform active:scale-95 shrink-0 ${
          isUrgent
            ? "timer-urgent border-[#E84057]"
            : remaining > 0
            ? "border-[#C8AA6E]"
            : slot === "R"
            ? "border-[#0AC8B9]/65 hover:border-[#0AC8B9]"
            : "border-[#C8AA6E]/35 hover:border-[#F0E6D2]"
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
      className="inline-flex flex-col w-max h-max rounded border border-[#C8AA6E]/40 overflow-hidden group"
      style={{
        backgroundColor: `rgba(4, 10, 20, ${opacity})`,
      }}
    >
      {/* Ultra-Compact Header (18px) */}
      <div className="h-[18px] px-1 bg-[#091428]/90 border-b border-[#C8AA6E]/25 flex items-center justify-between gap-1">
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            invoke("cmd_begin_drag");
          }}
          className="flex items-center gap-0.5 cursor-move min-w-0 py-0.5"
          title="Kéo thả để đặt vị trí"
        >
          <GripVertical className="w-2.5 h-2.5 text-[#C8AA6E]/80 shrink-0" />
          <span
            className={`text-[9px] font-bold leading-none ${
              matchState.inGame ? "text-[#0AC8B9]" : "text-[#C8AA6E]"
            }`}
          >
            {matchState.inGame ? formatGameClock(currentEstimatedGameSecs) : "DEMO"}
          </span>
        </div>

        <div className="flex items-center gap-[1px] shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
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

      {/* Micro Body */}
      {!collapsed && (
        <div
          style={{ padding: m.padPx, gap: layout === "horizontal" ? m.gapPx + 2 : m.gapPx }}
          className={layout === "horizontal" ? "flex items-center" : "flex flex-col"}
        >
          {matchState.enemies.map((enemy) => {
            const cosmic = isCosmicEnabled(enemy);

            if (layout === "horizontal") {
              return (
                <div
                  key={enemy.slotIndex}
                  style={{ gap: m.gapPx }}
                  className="flex flex-col items-center bg-[#091428]/55 rounded px-[2px] py-[2px] border border-[#C8AA6E]/20"
                >
                  <div className="w-full flex items-center justify-between gap-1">
                    <div className="flex items-center gap-0.5">
                      {enemy.championIconUrl ? (
                        <img
                          src={enemy.championIconUrl}
                          alt={enemy.championName}
                          style={{ width: 14, height: 14 }}
                          className="rounded-full border border-[#C8AA6E]/70 shrink-0"
                          draggable={false}
                        />
                      ) : null}
                      <span className={`${m.posText} font-bold text-[#C8AA6E] leading-none`}>
                        {enemy.position}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCosmicOverrides((prev) => ({
                          ...prev,
                          [enemy.slotIndex]: !cosmic,
                        }))
                      }
                      title={
                        cosmic
                          ? "Thấu Thị Vũ Trụ (+18 Haste Spell): ĐANG BẬT"
                          : "Bấm bật Thấu Thị Vũ Trụ (+18 Haste Spell)"
                      }
                      className={`p-[1px] rounded ${
                        cosmic ? "text-[#0AC8B9]" : "text-[#5B5A56] hover:text-[#C8AA6E]"
                      }`}
                    >
                      <Zap className="w-2.5 h-2.5" />
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

            // Micro Vertical Row: [Avatar] [D] [F] [R] [⚡]
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
                      className="rounded-full border border-[#C8AA6E]/80 object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div
                      style={{ width: m.avatarPx, height: m.avatarPx }}
                      className="rounded-full bg-[#010A13] border border-[#C8AA6E]/80 text-[8px] flex items-center justify-center font-bold"
                    >
                      {enemy.position}
                    </div>
                  )}
                  <span className="absolute -bottom-0.5 -right-0.5 bg-[#010A13]/95 rounded-sm px-[2px] text-[7px] font-bold leading-none text-[#F0E6D2]">
                    {enemy.level}
                  </span>
                </div>

                {renderSlotButton(enemy, "D")}
                {renderSlotButton(enemy, "F")}
                {renderSlotButton(enemy, "R")}

                <button
                  type="button"
                  onClick={() =>
                    setCosmicOverrides((prev) => ({
                      ...prev,
                      [enemy.slotIndex]: !cosmic,
                    }))
                  }
                  title={
                    cosmic
                      ? `${enemy.championName}: Đang bật Thấu Thị Vũ Trụ (+18 Haste Spell)`
                      : `${enemy.championName}: Bấm bật Thấu Thị Vũ Trụ (+18 Haste Spell)`
                  }
                  className={`p-[2px] rounded shrink-0 ${
                    cosmic
                      ? "bg-[#0AC8B9]/20 text-[#0AC8B9]"
                      : "text-[#5B5A56] hover:text-[#C8AA6E]"
                  }`}
                >
                  <Zap className="w-2.5 h-2.5" />
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
