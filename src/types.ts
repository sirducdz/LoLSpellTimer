export interface SpellInfo {
  id: string;
  nameVi: string;
  baseCd: number;
  effectiveCd: number;
  iconUrl: string;
}

export interface UltInfo {
  name: string;
  baseCds: [number, number, number];
  currentRank: number;
  baseCd: number;
  effectiveCd: number;
  iconUrl: string;
}

export interface EnemyTimerRow {
  slotIndex: number;
  position: string;
  riotId: string;
  championId: string;
  championName: string;
  championIconUrl: string;
  level: number;
  spellD: SpellInfo;
  spellF: SpellInfo;
  ult: UltInfo;
  itemAbilityHaste: number;
  bootsSpellHaste: number;
  hasInspirationRune: boolean;
}

export interface LiveMatchState {
  inGame: boolean;
  isDemo: boolean;
  gameTimeSecs: number;
  ddragonVersion: string;
  autoSyncRoom?: string | null;
  enemies: EnemyTimerRow[];
}

export interface TimerAppSettings {
  x: number;
  y: number;
  layout: "vertical" | "horizontal" | string;
  opacity: number;
  scale?: "S" | "M" | "L" | string;
  syncEnabled?: boolean;
  squadCode?: string;
}

export interface InitialPayload {
  matchState: LiveMatchState;
  settings: TimerAppSettings;
}
