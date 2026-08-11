import { storage } from 'wxt/storage';
import { AppState } from '../shared/types';

export const defaultState: AppState = {
  theme: 'dark',
  platform: null,
  status: 'healthy',
  tokenEstimate: { count: 0, inputCount: 0, outputCount: 0, confidence: 1, isStreaming: false },
  stats: {
    turns: 0,
    avgTokensPerTurn: 0,
    contextLimit: 128000,
    healthMetrics: {
      repetition: 'Low',
      lengthDrift: 'Stable',
      instruction: 'Good',
      explicit: 'None',
    },
  }, // Defaulting to standard limit
  thresholds: {
    caution: 70,
    warning: 85,
    critical: 95,
  },
  currentSummary: null,
  widgetPosition: { x: 20, y: 20 },
  widgetCollapsed: true,
  notificationsEnabled: true,
  trackingEnabled: true,
  onboardingComplete: false,
  snapshots: [],
  supportedPlatforms: {
    chatgpt: true,
    claude: true,
    gemini: true,
    grok: false,
    perplexity: false,
  },
  summaryFrequency: 5,
  exportFormat: 'markdown',
  storageLocation: 'local',
  privacy: {
    enableHistory: true,
    allowAnalytics: false,
  },
  estimatedContext: {
    observedTokens: 0,
    estimatedTokens: 0,
    observedTurns: 0,
    estimatedTurns: 0,
    coverageRatio: 1.0,
    estimationSource: 'none',
  },
};

type RuntimeState = Pick<
  AppState,
  'platform' | 'status' | 'tokenEstimate' | 'stats' | 'currentSummary' | 'estimatedContext'
>;
type SettingsState = Pick<
  AppState,
  | 'theme'
  | 'thresholds'
  | 'widgetPosition'
  | 'widgetCollapsed'
  | 'notificationsEnabled'
  | 'trackingEnabled'
  | 'onboardingComplete'
  | 'supportedPlatforms'
  | 'summaryFrequency'
  | 'exportFormat'
  | 'storageLocation'
  | 'privacy'
>;
type SnapshotState = Pick<AppState, 'snapshots'>;

const defaultRuntimeState: RuntimeState = {
  platform: defaultState.platform,
  status: defaultState.status,
  tokenEstimate: defaultState.tokenEstimate,
  stats: defaultState.stats,
  currentSummary: defaultState.currentSummary,
  estimatedContext: defaultState.estimatedContext,
};

const defaultSettingsState: SettingsState = {
  theme: defaultState.theme,
  thresholds: defaultState.thresholds,
  widgetPosition: defaultState.widgetPosition,
  widgetCollapsed: defaultState.widgetCollapsed,
  notificationsEnabled: defaultState.notificationsEnabled,
  trackingEnabled: defaultState.trackingEnabled,
  onboardingComplete: defaultState.onboardingComplete,
  supportedPlatforms: defaultState.supportedPlatforms,
  summaryFrequency: defaultState.summaryFrequency,
  exportFormat: defaultState.exportFormat,
  storageLocation: defaultState.storageLocation,
  privacy: defaultState.privacy,
};

const defaultSnapshotState: SnapshotState = {
  snapshots: defaultState.snapshots,
};

async function readMergedState(tabId?: number): Promise<AppState> {
  const [runtimeStateMap, settingsState, snapshotState, activeTabId] = await Promise.all([
    storageLayer.runtimeState.getValue(),
    storageLayer.settingsState.getValue(),
    storageLayer.snapshotState.getValue(),
    storageLayer.activeTabId.getValue(),
  ]);

  const targetTabId = tabId ?? activeTabId;
  const runtimeState =
    targetTabId && runtimeStateMap[targetTabId]
      ? runtimeStateMap[targetTabId]
      : defaultRuntimeState;

  return {
    ...defaultState,
    ...settingsState,
    ...runtimeState,
    ...snapshotState,
  };
}

function splitUpdates(updates: Partial<AppState>) {
  const runtimeUpdates: Partial<RuntimeState> = {};
  const settingsUpdates: Partial<SettingsState> = {};
  const snapshotUpdates: Partial<SnapshotState> = {};

  for (const [key, value] of Object.entries(updates) as [
    keyof AppState,
    AppState[keyof AppState],
  ][]) {
    if (key in defaultRuntimeState) {
      Object.assign(runtimeUpdates, { [key]: value });
    } else if (key in defaultSettingsState) {
      Object.assign(settingsUpdates, { [key]: value });
    } else if (key in defaultSnapshotState) {
      Object.assign(snapshotUpdates, { [key]: value });
    }
  }

  return { runtimeUpdates, settingsUpdates, snapshotUpdates };
}

export const storageLayer = {
  runtimeState: storage.defineItem<Record<number, RuntimeState>>('local:runtimeState', {
    fallback: {},
  }),

  settingsState: storage.defineItem<SettingsState>('sync:settingsState', {
    fallback: defaultSettingsState,
  }),

  snapshotState: storage.defineItem<SnapshotState>('local:snapshotState', {
    fallback: defaultSnapshotState,
  }),

  appState: {
    getValue: readMergedState,
    async setValue(nextState: AppState, tabId?: number) {
      const { runtimeUpdates, settingsUpdates, snapshotUpdates } = splitUpdates(nextState);
      const targetTabId = tabId ?? (await storageLayer.activeTabId.getValue());

      const runtimeStateMap = await storageLayer.runtimeState.getValue();
      const updatedRuntimeMap = targetTabId
        ? { ...runtimeStateMap, [targetTabId]: { ...defaultRuntimeState, ...runtimeUpdates } }
        : runtimeStateMap;

      await Promise.all([
        storageLayer.runtimeState.setValue(updatedRuntimeMap),
        storageLayer.settingsState.setValue({ ...defaultSettingsState, ...settingsUpdates }),
        storageLayer.snapshotState.setValue({ ...defaultSnapshotState, ...snapshotUpdates }),
      ]);
    },
    watch(callback: (newValue: AppState, oldValue: AppState) => void) {
      let previousState: AppState | null = null;
      const notify = async () => {
        const nextState = await readMergedState();
        callback(nextState, previousState ?? nextState);
        previousState = nextState;
      };

      const stops = [
        storageLayer.runtimeState.watch(notify),
        storageLayer.settingsState.watch(notify),
        storageLayer.snapshotState.watch(notify),
      ];

      return () => stops.forEach((stop) => stop());
    },
  },

  activeTabId: storage.defineItem<number | null>('local:activeTabId', {
    fallback: null,
  }),

  async updateAppState(updates: Partial<AppState>, tabId?: number) {
    const { runtimeUpdates, settingsUpdates, snapshotUpdates } = splitUpdates(updates);
    const updatePromises: Promise<void>[] = [];
    
    console.log(`[Storage] Saving state updates for keys: ${Object.keys(updates).join(', ')}`);

    if (Object.keys(runtimeUpdates).length > 0) {
      updatePromises.push(
        Promise.all([
          this.runtimeState.getValue(),
          tabId ? Promise.resolve(tabId) : this.activeTabId.getValue(),
        ]).then(([stateMap, targetTabId]) => {
          if (targetTabId) {
            const currentTabState = stateMap[targetTabId] || defaultRuntimeState;
            return this.runtimeState.setValue({
              ...stateMap,
              [targetTabId]: { ...currentTabState, ...runtimeUpdates },
            });
          }
        })
      );
    }

    if (Object.keys(settingsUpdates).length > 0) {
      updatePromises.push(
        this.settingsState
          .getValue()
          .then((state) => this.settingsState.setValue({ ...state, ...settingsUpdates }))
      );
    }
    if (Object.keys(snapshotUpdates).length > 0) {
      updatePromises.push(
        this.snapshotState
          .getValue()
          .then((state) => this.snapshotState.setValue({ ...state, ...snapshotUpdates }))
      );
    }

    await Promise.all(updatePromises);
  },

  watchAppState(callback: (newValue: AppState, oldValue: AppState) => void) {
    return this.appState.watch(callback);
  },
};
