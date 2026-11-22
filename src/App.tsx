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
  const [collapsed, setCollapsed] = useState(false);
  const [opacity, setOpacity] = useState(0.92);
  const [timers, setTimers] = useState<Record<string, ActiveTimer>>({});
  const [cosmicOverrides, setCosmicOverrides] = useState<Record<number, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedNotice, setCopiedNotice] = useState(false);

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
      setLayout(l);
      setOpacity(payload.settings.opacity || 0.92);
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
      // Reset timers if transitioning between demo <-> live or a new match started
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
    window.setTimeout(() => setCopiedNotice(false), 1600);
  };

  const toggleLayout = async () => {
    const next = layout === "vertical" ? "horizontal" : "vertical";
    setLayout(next);
    setCollapsed(false);
    await invoke("cmd_set_layout_and_collapse", { layout: next, collapsed: false });
  };

  const toggleCollapse = async () => {
    const next = !collapsed;
    setCollapsed(next);
    await invoke("cmd_set_layout_and_collapse", { layout, collapsed: next });
  };

  const cycleOpacity = async () => {
    const next = opacity > 0.86 ? 0.78 : opacity > 0.68 ? 0.58 : 0.92;
    setOpacity(next);
    await invoke("cmd_save_opacity", { opacity: next });
  };

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
        ? `${enemy.spellD.nameVi} (${effCd}s) — Trái: Đếm / -5s | Phải: Reset`
        : slot === "F"
        ? `${enemy.spellF.nameVi} (${effCd}s) — Trái: Đếm / -5s | Phải: Reset`
        : `${enemy.ult.name} Cấp ${enemy.ult.currentRank} (${effCd}s) — Trái: Đếm / -5s | Phải: Reset`;

    const sizeClass = layout === "horizontal" ? "w-9 h-9" : "w-10 h-10";

    return (
      <button
        key={slot}
        type="button"
        title={tooltip}
        onClick={() => handleTimerClick(enemy, slot)}
        onContextMenu={(e) => handleTimerRightClick(e, enemy, slot)}
        className={`relative ${sizeClass} rounded overflow-hidden border transition-transform active:scale-95 shrink-0 ${
          isUrgent
            ? "timer-urgent border-[#E84057]"
            : remaining > 0
            ? "border-[#C8AA6E]/80"
            : slot === "R"
            ? "border-[#0AC8B9]/60 hover:border-[#0AC8B9]"
            : "border-[#C8AA6E]/45 hover:border-[#F0E6D2]"
        } bg-[#010A13]`}
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt={fallbackLabel}
            className={`w-full h-full object-cover ${
              remaining > 0 ? "brightness-[0.35] grayscale-[40%]" : "brightness-100"
            }`}
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-[#C8AA6E]">
            {fallbackLabel}
          </div>
        )}

        {/* Slot tag R / D / F when ready */}
        {remaining === 0 && (
          <>
            <span
              className={`absolute top-0 left-0 px-1 text-[8px] font-bold leading-tight bg-black/75 ${
                slot === "R" ? "text-[#0AC8B9]" : "text-[#C8AA6E]"
              }`}
            >
              {slot}
            </span>
            <span className="absolute bottom-0 right-0 px-1 text-[9px] font-bold leading-tight bg-black/80 text-[#F0E6D2]">
              {effCd}s
            </span>
          </>
        )}

        {/* Countdown text */}
        {remaining > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span
              className={`font-black leading-none tracking-tight ${
                remaining >= 60 ? "text-[11px]" : "text-[13px]"
              } ${isUrgent ? "text-[#FF6B7F]" : "text-[#F0E6D2]"}`}
              style={{ textShadow: "0 1px 3px #000" }}
            >
              {formatShortRemaining(remaining)}
            </span>
          </div>
        )}

        {/* -5s quick feedback */}
        {showMinus5 && (
          <span className="absolute top-0 right-0.5 text-[9px] font-black text-[#0AC8B9]">
            -5s
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
      className="w-full h-full rounded-md border border-[#C8AA6E]/60 flex flex-col overflow-hidden shadow-2xl"
      style={{
        backgroundColor: `rgba(5, 14, 26, ${opacity})`,
      }}
    >
      {/* Compact Header / Drag Handle */}
      <div className="h-[30px] px-2 bg-[#091428]/95 border-b border-[#C8AA6E]/30 flex items-center justify-between gap-1 shrink-0">
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            invoke("cmd_begin_drag");
          }}
          className="flex items-center gap-1 cursor-move flex-1 min-w-0 py-1"
          title="Kéo thả để di chuyển vị trí"
        >
          <GripVertical className="w-3.5 h-3.5 text-[#C8AA6E] shrink-0" />
          {matchState.inGame ? (
            <span className="text-[10px] font-bold text-[#0AC8B9] truncate">
              ● LIVE {formatGameClock(currentEstimatedGameSecs)}
            </span>
          ) : (
            <span className="text-[10px] font-bold text-[#C8AA6E] truncate">
              ● XEM THỬ
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={handleCopyTimers}
                title="Copy mốc giờ hồi vào Clipboard"
                className="px-1.5 py-0.5 rounded bg-[#010A13] border border-[#C8AA6E]/40 hover:border-[#0AC8B9] text-[10px] font-semibold text-[#F0E6D2] flex items-center gap-1"
              >
                {copiedNotice ? (
                  <Check className="w-3 h-3 text-[#0AC8B9]" />
                ) : (
                  <Copy className="w-3 h-3 text-[#C8AA6E]" />
                )}
                <span>{copiedNotice ? "Đã chép" : "Copy"}</span>
              </button>

              <button
                type="button"
                onClick={toggleLayout}
                title={layout === "vertical" ? "Chuyển sang Thanh Ngang" : "Chuyển sang Thanh Dọc"}
                className="p-1 rounded hover:bg-[#C8AA6E]/15 text-[#C8AA6E]"
              >
                {layout === "vertical" ? (
                  <Columns2 className="w-3.5 h-3.5" />
                ) : (
                  <Rows3 className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={cycleOpacity}
                title={`Độ mờ: ${Math.round(opacity * 100)}% (Bấm để đổi)`}
                className="p-1 rounded hover:bg-[#C8AA6E]/15 text-[#A09B8C] hover:text-[#F0E6D2]"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={toggleCollapse}
            title={collapsed ? "Mở rộng bảng đếm" : "Thu gọn thành thanh nhỏ"}
            className="p-1 rounded hover:bg-[#C8AA6E]/15 text-[#C8AA6E]"
          >
            {collapsed ? <Plus className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => invoke("cmd_quit_timer")}
            title="Đóng LoL Spell Timer"
            className="p-1 rounded hover:bg-[#E84057]/20 text-[#A09B8C] hover:text-[#E84057]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div
          className={`flex-1 p-1.5 ${
            layout === "horizontal"
              ? "grid grid-cols-5 gap-1.5 items-center"
              : "flex flex-col justify-between gap-1"
          }`}
        >
          {matchState.enemies.map((enemy) => {
            const cosmic = isCosmicEnabled(enemy);
            if (layout === "horizontal") {
              return (
                <div
                  key={enemy.slotIndex}
                  className="bg-[#091428]/70 border border-[#C8AA6E]/25 rounded px-1.5 py-1 flex flex-col items-center gap-1"
                >
                  <div className="w-full flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1 min-w-0">
                      {enemy.championIconUrl ? (
                        <img
                          src={enemy.championIconUrl}
                          alt={enemy.championName}
                          className="w-5 h-5 rounded-full border border-[#C8AA6E]/70 shrink-0"
                          draggable={false}
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-[#010A13] border border-[#C8AA6E]/70 text-[9px] flex items-center justify-center">
                          {enemy.championName.slice(0, 2)}
                        </div>
                      )}
                      <span className="text-[10px] font-bold text-[#F0E6D2] truncate">
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
                          ? "Đang bật Ngọc Thấu Thị Vũ Trụ (+18 Haste Spell)"
                          : "Bấm để bật Ngọc Thấu Thị Vũ Trụ (+18 Haste Spell)"
                      }
                      className={`p-0.5 rounded border ${
                        cosmic
                          ? "bg-[#0AC8B9]/25 border-[#0AC8B9] text-[#0AC8B9]"
                          : "bg-[#010A13]/70 border-[#C8AA6E]/20 text-[#5B5A56] hover:text-[#C8AA6E]"
                      }`}
                    >
                      <Zap className="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    {renderSlotButton(enemy, "D")}
                    {renderSlotButton(enemy, "F")}
                    {renderSlotButton(enemy, "R")}
                  </div>
                </div>
              );
            }

            // Vertical Row
            return (
              <div
                key={enemy.slotIndex}
                className="bg-[#091428]/70 border border-[#C8AA6E]/25 rounded px-2 py-1 flex items-center justify-between gap-1.5"
              >
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <div className="relative shrink-0">
                    {enemy.championIconUrl ? (
                      <img
                        src={enemy.championIconUrl}
                        alt={enemy.championName}
                        className="w-9 h-9 rounded-full border border-[#C8AA6E] object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-[#010A13] border border-[#C8AA6E] text-[10px] flex items-center justify-center font-bold">
                        {enemy.championName.slice(0, 2)}
                      </div>
                    )}
                    <span className="absolute -bottom-1 -right-1 bg-[#010A13] border border-[#C8AA6E]/70 rounded px-1 text-[8px] font-bold text-[#F0E6D2]">
                      {enemy.level}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-[#F0E6D2] truncate leading-tight">
                      {enemy.championName}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[9px] font-semibold text-[#C8AA6E]">
                        {enemy.position}
                      </span>
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
                            ? "Đang bật Ngọc Thấu Thị Vũ Trụ (+18 Haste Spell)"
                            : "Bấm để bật Ngọc Thấu Thị Vũ Trụ (+18 Haste Spell)"
                        }
                        className={`px-1 py-0 rounded border inline-flex items-center gap-0.5 text-[8px] font-bold ${
                          cosmic
                            ? "bg-[#0AC8B9]/20 border-[#0AC8B9]/70 text-[#0AC8B9]"
                            : "bg-[#010A13]/70 border-[#C8AA6E]/25 text-[#5B5A56] hover:text-[#C8AA6E]"
                        }`}
                      >
                        <Zap className="w-2.5 h-2.5" />
                        +18
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {renderSlotButton(enemy, "D")}
                  {renderSlotButton(enemy, "F")}
                  {renderSlotButton(enemy, "R")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
