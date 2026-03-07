import { useMemo, useState } from "react";

const storageKeys = {
  apiBase: "rps_api_base",
  token: "rps_token",
};

const CURRENCIES = ["TON", "STARS"];
const VISIBILITY = ["PUBLIC", "PRIVATE"];
const MOVES = ["ROCK", "PAPER", "SCISSORS"];
const TEST_PRESETS = [
  {
    key: "player1",
    label: "Player 1",
    telegramId: 900001,
    username: "tg_test_p1",
    firstName: "Test",
    lastName: "One",
    languageCode: "ru",
  },
  {
    key: "player2",
    label: "Player 2",
    telegramId: 900002,
    username: "tg_test_p2",
    firstName: "Test",
    lastName: "Two",
    languageCode: "ru",
  },
];

function toJson(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value ?? {}, null, 2);
}

function makeOut(value = "", error = false) {
  return { value, error };
}

function generateSalt() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function pickLobby(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (payload.lobby && typeof payload.lobby === "object") {
    return payload.lobby;
  }

  return payload;
}

function extractLobbies(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
}

function formatMoney(value) {
  if (value === undefined || value === null || value === "") {
    return "0";
  }

  const text = String(value);
  const sign = text.startsWith("-") ? "-" : "";
  const normalized = sign ? text.slice(1) : text;
  return `${sign}${normalized.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

function readMatchId(payload) {
  return payload?.matchId || payload?.match?.id || payload?.matches?.[0]?.id || "";
}

function statusTone(status) {
  const value = String(status || "").toUpperCase();

  if (["WAITING", "WAITING_COMMIT", "WAITING_REVEAL"].includes(value)) {
    return "warn";
  }

  if (["RUNNING", "ACTIVE", "RESOLVED", "PLAYER1_WIN", "PLAYER2_WIN", "DRAW"].includes(value)) {
    return "ok";
  }

  if (["CLOSED", "CANCELED", "FAILED"].includes(value)) {
    return "bad";
  }

  return "neutral";
}

function tinyDate(date) {
  try {
    return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "--:--:--";
  }
}

function getBalanceValue(balances, currency, field) {
  const found = Array.isArray(balances) ? balances.find((entry) => entry.currency === currency) : null;
  return found?.[field] ?? 0;
}

export default function App() {
  const [apiBase, setApiBase] = useState(() => localStorage.getItem(storageKeys.apiBase) || "http://localhost:3000");
  const [token, setToken] = useState(() => localStorage.getItem(storageKeys.token) || "");
  const [initData, setInitData] = useState("");

  const [walletCurrency, setWalletCurrency] = useState("TON");
  const [walletAmount, setWalletAmount] = useState("1000000");
  const [walletIdempotency, setWalletIdempotency] = useState("");
  const [walletBalances, setWalletBalances] = useState([]);

  const [createCurrency, setCreateCurrency] = useState("TON");
  const [createStake, setCreateStake] = useState("1000");
  const [createVisibility, setCreateVisibility] = useState("PUBLIC");
  const [createAutoStart, setCreateAutoStart] = useState(true);

  const [lobbies, setLobbies] = useState([]);
  const [lobbyId, setLobbyId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [listOnlyJoinable, setListOnlyJoinable] = useState("true");
  const [listCurrencyFilter, setListCurrencyFilter] = useState("ALL");

  const [matchId, setMatchId] = useState("");
  const [move, setMove] = useState("ROCK");
  const [salt, setSalt] = useState(() => generateSalt());
  const [commitHash, setCommitHash] = useState("");
  const [seedAmountMinor, setSeedAmountMinor] = useState("1000000");
  const [activeTestUserKey, setActiveTestUserKey] = useState("");
  const [testUsers, setTestUsers] = useState(() =>
    TEST_PRESETS.map((entry) => ({
      ...entry,
      accessToken: "",
      user: null,
      balances: [],
    }))
  );

  const [isLoading, setIsLoading] = useState({
    auth: false,
    wallet: false,
    lobby: false,
    match: false,
  });

  const [authOut, setAuthOut] = useState(makeOut());
  const [walletOut, setWalletOut] = useState(makeOut());
  const [lobbyOut, setLobbyOut] = useState(makeOut());
  const [matchOut, setMatchOut] = useState(makeOut());
  const [logs, setLogs] = useState([]);

  const canCallProtectedApi = useMemo(() => token.trim().length > 0, [token]);

  const selectedLobby = useMemo(() => {
    return lobbies.find((entry) => entry.id === lobbyId.trim()) || null;
  }, [lobbies, lobbyId]);

  const activeTestUser = useMemo(() => {
    return testUsers.find((entry) => entry.key === activeTestUserKey) || null;
  }, [testUsers, activeTestUserKey]);

  const visibleLobbies = useMemo(() => {
    const source = Array.isArray(lobbies) ? lobbies : [];

    return source.filter((entry) => {
      if (listCurrencyFilter !== "ALL" && entry.currency !== listCurrencyFilter) {
        return false;
      }

      if (listOnlyJoinable === "true") {
        const current = Number(entry.participants?.length || 0);
        const max = Number(entry.maxPlayers || 2);
        return current < max && entry.status === "WAITING";
      }

      return true;
    });
  }, [lobbies, listCurrencyFilter, listOnlyJoinable]);

  const liveMatchId = useMemo(() => {
    if (matchId.trim()) {
      return matchId.trim();
    }

    return selectedLobby?.matches?.[0]?.id || "";
  }, [matchId, selectedLobby]);

  function appendLog(level, text, extra) {
    const stamp = new Date().toISOString();
    setLogs((prev) => [{ stamp, level, text, extra }, ...prev].slice(0, 120));
  }

  function setOut(setter, value, error = false) {
    setter(makeOut(toJson(value ?? "OK"), error));
  }

  function patchLoading(key, value) {
    setIsLoading((prev) => ({ ...prev, [key]: value }));
  }

  function applyToken(nextToken) {
    const trimmed = String(nextToken || "").trim();
    setToken(trimmed);
    localStorage.setItem(storageKeys.token, trimmed);
  }

  function updateTestUserState(userKey, patch) {
    setTestUsers((prev) => prev.map((entry) => (entry.key === userKey ? { ...entry, ...patch } : entry)));
  }

  function syncTestUserBalancesByToken(accessToken, balances) {
    if (!accessToken) {
      return;
    }

    setTestUsers((prev) =>
      prev.map((entry) => (entry.accessToken === accessToken ? { ...entry, balances: Array.isArray(balances) ? balances : [] } : entry))
    );
  }

  async function api(path, options = {}) {
    const method = options.method || "GET";
    const normalizedApiBase = apiBase.trim().replace(/\/+$/, "");
    const currentToken = token.trim();
    const authToken = typeof options.token === "string" ? options.token.trim() : currentToken;
    const headers = {};

    if (options.auth !== false && authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${normalizedApiBase}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const raw = await response.text();
    let payload = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }

    if (!response.ok) {
      const error = new Error(`${method} ${path} failed with ${response.status}`);
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function runWithUi({ scope, label, setter, request, onSuccess }) {
    patchLoading(scope, true);

    try {
      const data = await request();
      setOut(setter, data, false);
      appendLog("ok", `${label} success`, data);
      if (onSuccess) {
        onSuccess(data);
      }
      return data;
    } catch (error) {
      const details = error.payload || { message: error.message };
      setOut(setter, details, true);
      appendLog("error", `${label} failed`, details);
      return null;
    } finally {
      patchLoading(scope, false);
    }
  }

  function saveConfig() {
    const normalizedApiBase = apiBase.trim().replace(/\/+$/, "");
    const trimmedToken = token.trim();

    setApiBase(normalizedApiBase);
    localStorage.setItem(storageKeys.apiBase, normalizedApiBase);
    applyToken(trimmedToken);

    setOut(setAuthOut, { message: "Config saved" }, false);
    appendLog("ok", "Config saved", { apiBase: normalizedApiBase, tokenPresent: Boolean(trimmedToken) });
  }

  function updateLobbyContext(data) {
    const nextLobby = pickLobby(data);

    if (nextLobby?.id) {
      setLobbyId(nextLobby.id);

      setLobbies((prev) => {
        const withoutCurrent = prev.filter((entry) => entry.id !== nextLobby.id);
        return [nextLobby, ...withoutCurrent];
      });
    }

    const nextMatchId = readMatchId(data) || readMatchId(nextLobby);
    if (nextMatchId) {
      setMatchId(nextMatchId);
    }
  }

  async function handleAuthMe() {
    await runWithUi({
      scope: "auth",
      label: "auth/me",
      setter: setAuthOut,
      request: () => api("/api/auth/me"),
    });
  }

  async function handleTelegramLogin() {
    await runWithUi({
      scope: "auth",
      label: "auth/telegram",
      setter: setAuthOut,
      request: () =>
        api("/api/auth/telegram", {
          method: "POST",
          auth: false,
          body: { initData: initData.trim() },
        }),
      onSuccess: (data) => {
        if (data?.accessToken) {
          applyToken(data.accessToken);
          setActiveTestUserKey("");
        }
      },
    });
  }

  async function loginMockPreset(preset) {
    const authData = await api("/api/auth/telegram/mock", {
      method: "POST",
      auth: false,
      body: {
        telegramId: preset.telegramId,
        username: preset.username,
        firstName: preset.firstName,
        lastName: preset.lastName,
        languageCode: preset.languageCode,
      },
    });

    if (!authData?.accessToken) {
      throw new Error("Mock login did not return access token");
    }

    const balances = await api("/api/wallet/balances", {
      token: authData.accessToken,
    });

    const normalizedBalances = Array.isArray(balances) ? balances : [];
    updateTestUserState(preset.key, {
      accessToken: authData.accessToken,
      user: authData.user ?? null,
      balances: normalizedBalances,
    });

    return {
      authData,
      balances: normalizedBalances,
    };
  }

  async function topUpByToken(accessToken, idKey) {
    const normalizedAmount = seedAmountMinor.trim();
    if (!normalizedAmount) {
      throw new Error("Seed amount is required");
    }

    const nonce = Date.now();
    for (const currency of CURRENCIES) {
      await api("/api/wallet/deposit/mock", {
        method: "POST",
        token: accessToken,
        body: {
          currency,
          amountMinor: normalizedAmount,
          idempotencyKey: `seed-${idKey}-${currency}-${nonce}`,
        },
      });
    }

    const balances = await api("/api/wallet/balances", {
      token: accessToken,
    });

    return Array.isArray(balances) ? balances : [];
  }

  function handleUseTestUser(userKey) {
    const profile = testUsers.find((entry) => entry.key === userKey);
    if (!profile?.accessToken) {
      setOut(setAuthOut, { message: "User token not found. Run mock login first." }, true);
      return;
    }

    setActiveTestUserKey(userKey);
    applyToken(profile.accessToken);
    setWalletBalances(Array.isArray(profile.balances) ? profile.balances : []);
    appendLog("ok", `Switched to ${profile.label}`, { userId: profile.user?.id, telegramId: profile.telegramId });
    setOut(setAuthOut, { message: `Active token switched to ${profile.label}` }, false);
  }

  async function handleMockLoginUser(userKey) {
    const profile = TEST_PRESETS.find((entry) => entry.key === userKey);
    if (!profile) {
      return;
    }

    patchLoading("auth", true);
    patchLoading("wallet", true);

    try {
      const { authData, balances } = await loginMockPreset(profile);
      setActiveTestUserKey(userKey);
      applyToken(authData.accessToken);
      setWalletBalances(balances);
      setOut(setAuthOut, authData, false);
      setOut(setWalletOut, balances, false);
      appendLog("ok", `Mock login for ${profile.label} ready`, {
        userId: authData.user?.id,
        telegramId: profile.telegramId,
      });
    } catch (error) {
      const details = error?.payload || { message: error.message };
      setOut(setAuthOut, details, true);
      appendLog("error", `Mock login for ${profile.label} failed`, details);
    } finally {
      patchLoading("auth", false);
      patchLoading("wallet", false);
    }
  }

  async function handleTopUpTestUser(userKey) {
    const profile = TEST_PRESETS.find((entry) => entry.key === userKey);
    if (!profile) {
      return;
    }

    patchLoading("auth", true);
    patchLoading("wallet", true);

    try {
      const existing = testUsers.find((entry) => entry.key === userKey);
      const accessToken = existing?.accessToken || (await loginMockPreset(profile)).authData.accessToken;
      const balances = await topUpByToken(accessToken, `${userKey}-single`);

      updateTestUserState(userKey, { accessToken, balances });
      if (activeTestUserKey === userKey) {
        setWalletBalances(balances);
      }

      setOut(setWalletOut, balances, false);
      appendLog("ok", `Top up completed for ${profile.label}`, {
        amountMinor: seedAmountMinor,
        balances,
      });
    } catch (error) {
      const details = error?.payload || { message: error.message };
      setOut(setWalletOut, details, true);
      appendLog("error", `Top up failed for ${profile.label}`, details);
    } finally {
      patchLoading("auth", false);
      patchLoading("wallet", false);
    }
  }

  async function handleSeedTwoUsers() {
    patchLoading("auth", true);
    patchLoading("wallet", true);

    try {
      const seeded = [];

      for (const preset of TEST_PRESETS) {
        const { authData } = await loginMockPreset(preset);
        const balances = await topUpByToken(authData.accessToken, `${preset.key}-batch`);
        updateTestUserState(preset.key, {
          accessToken: authData.accessToken,
          user: authData.user ?? null,
          balances,
        });
        seeded.push({
          key: preset.key,
          label: preset.label,
          telegramId: preset.telegramId,
          userId: authData.user?.id,
          accessToken: authData.accessToken,
          balances,
        });
      }

      if (seeded.length > 0) {
        setActiveTestUserKey(seeded[0].key);
        applyToken(seeded[0].accessToken);
        setWalletBalances(seeded[0].balances);
      }

      setOut(setAuthOut, { message: "Two test users seeded", users: seeded.map(({ accessToken, ...rest }) => rest) }, false);
      setOut(
        setWalletOut,
        seeded.map((entry) => ({
          label: entry.label,
          balances: entry.balances,
        })),
        false
      );
      appendLog("ok", "Seeded two mock telegram users", {
        amountMinor: seedAmountMinor,
        users: seeded.map((entry) => ({ label: entry.label, telegramId: entry.telegramId, userId: entry.userId })),
      });
    } catch (error) {
      const details = error?.payload || { message: error.message };
      setOut(setAuthOut, details, true);
      setOut(setWalletOut, details, true);
      appendLog("error", "Failed to seed mock telegram users", details);
    } finally {
      patchLoading("auth", false);
      patchLoading("wallet", false);
    }
  }

  async function handleDeposit() {
    await runWithUi({
      scope: "wallet",
      label: "wallet/deposit/mock",
      setter: setWalletOut,
      request: () =>
        api("/api/wallet/deposit/mock", {
          method: "POST",
          body: {
            currency: walletCurrency,
            amountMinor: walletAmount.trim(),
            ...(walletIdempotency.trim() ? { idempotencyKey: walletIdempotency.trim() } : {}),
          },
        }),
    });

    await handleBalances();
  }

  async function handleBalances() {
    const currentToken = token.trim();
    await runWithUi({
      scope: "wallet",
      label: "wallet/balances",
      setter: setWalletOut,
      request: () => api("/api/wallet/balances"),
      onSuccess: (data) => {
        if (Array.isArray(data)) {
          setWalletBalances(data);
          syncTestUserBalancesByToken(currentToken, data);
        } else {
          setWalletBalances([]);
        }
      },
    });
  }

  async function handleCreateLobby() {
    await runWithUi({
      scope: "lobby",
      label: "lobbies/create",
      setter: setLobbyOut,
      request: () =>
        api("/api/lobbies", {
          method: "POST",
          body: {
            currency: createCurrency,
            stakeMinor: createStake.trim(),
            visibility: createVisibility,
            autoStart: createAutoStart,
          },
        }),
      onSuccess: (data) => {
        updateLobbyContext(data);
      },
    });

    await handleListLobbies();
  }

  async function handleListLobbies() {
    const query = new URLSearchParams();
    if (listOnlyJoinable === "true") {
      query.set("onlyJoinable", "true");
    }

    const path = query.toString() ? `/api/lobbies?${query.toString()}` : "/api/lobbies";

    await runWithUi({
      scope: "lobby",
      label: "lobbies/list",
      setter: setLobbyOut,
      request: () => api(path),
      onSuccess: (data) => {
        setLobbies(extractLobbies(data));
      },
    });
  }

  async function handleGetLobby(targetLobbyId = lobbyId) {
    const id = targetLobbyId.trim();

    if (!id) {
      setOut(setLobbyOut, { message: "Lobby ID is required" }, true);
      return;
    }

    await runWithUi({
      scope: "lobby",
      label: `lobbies/get ${id}`,
      setter: setLobbyOut,
      request: () => api(`/api/lobbies/${encodeURIComponent(id)}`),
      onSuccess: (data) => {
        updateLobbyContext(data);
      },
    });
  }

  async function handleJoinLobby(targetLobbyId = lobbyId) {
    const id = targetLobbyId.trim();

    if (!id) {
      setOut(setLobbyOut, { message: "Lobby ID is required" }, true);
      return;
    }

    await runWithUi({
      scope: "lobby",
      label: `lobbies/join ${id}`,
      setter: setLobbyOut,
      request: () =>
        api(`/api/lobbies/${encodeURIComponent(id)}/join`, {
          method: "POST",
          body: joinCode.trim() ? { joinCode: joinCode.trim() } : {},
        }),
      onSuccess: (data) => {
        updateLobbyContext(data);
      },
    });

    await handleListLobbies();
  }

  async function handleLeaveLobby(targetLobbyId = lobbyId) {
    const id = targetLobbyId.trim();

    if (!id) {
      setOut(setLobbyOut, { message: "Lobby ID is required" }, true);
      return;
    }

    await runWithUi({
      scope: "lobby",
      label: `lobbies/leave ${id}`,
      setter: setLobbyOut,
      request: () =>
        api(`/api/lobbies/${encodeURIComponent(id)}/leave`, {
          method: "POST",
        }),
      onSuccess: (data) => {
        updateLobbyContext(data);
      },
    });

    await handleListLobbies();
  }

  async function handleAutoJoin() {
    await runWithUi({
      scope: "lobby",
      label: "lobbies/auto-join",
      setter: setLobbyOut,
      request: () =>
        api("/api/lobbies/auto-join", {
          method: "POST",
          body: {
            currency: createCurrency,
            stakeMinor: createStake.trim(),
          },
        }),
      onSuccess: (data) => {
        updateLobbyContext(data);
      },
    });

    await handleListLobbies();
  }

  async function handleBuildHash() {
    const nextHash = await sha256Hex(`${move}:${salt.trim()}`);
    setCommitHash(nextHash);
    appendLog("ok", "Commit hash built", { move, salt: salt.trim(), commitHash: nextHash });
  }

  async function handleGetMatch() {
    const id = liveMatchId;

    if (!id) {
      setOut(setMatchOut, { message: "Match ID is required" }, true);
      return;
    }

    await runWithUi({
      scope: "match",
      label: `matches/get ${id}`,
      setter: setMatchOut,
      request: () => api(`/api/matches/${encodeURIComponent(id)}`),
    });
  }

  async function handleCommit() {
    const id = liveMatchId;

    if (!id) {
      setOut(setMatchOut, { message: "Match ID is required" }, true);
      return;
    }

    await runWithUi({
      scope: "match",
      label: `matches/commit ${id}`,
      setter: setMatchOut,
      request: () =>
        api(`/api/matches/${encodeURIComponent(id)}/commit`, {
          method: "POST",
          body: { commitHash: commitHash.trim() },
        }),
    });
  }

  async function handleReveal() {
    const id = liveMatchId;

    if (!id) {
      setOut(setMatchOut, { message: "Match ID is required" }, true);
      return;
    }

    await runWithUi({
      scope: "match",
      label: `matches/reveal ${id}`,
      setter: setMatchOut,
      request: () =>
        api(`/api/matches/${encodeURIComponent(id)}/reveal`, {
          method: "POST",
          body: {
            move,
            salt: salt.trim(),
          },
        }),
    });
  }

  return (
    <main className="app-shell">
      <div className="ambient ambient-a" aria-hidden="true" />
      <div className="ambient ambient-b" aria-hidden="true" />
      <div className="ambient ambient-c" aria-hidden="true" />

      <header className="hero panel">
        <div>
          <p className="eyebrow">RPS Command Lobby</p>
          <h1>Lobby, Wallet, Match</h1>
          <p className="lead">Single-screen control room for creating tables, joining players and resolving rounds.</p>
        </div>
        <div className="hero-stats">
          <div className="stat-chip">
            <span>API</span>
            <strong>{apiBase.replace(/^https?:\/\//, "")}</strong>
          </div>
          <div className="stat-chip">
            <span>Auth</span>
            <strong>{canCallProtectedApi ? "Token set" : "No token"}</strong>
          </div>
          <div className="stat-chip">
            <span>Player</span>
            <strong>{activeTestUser?.label || "Manual token"}</strong>
          </div>
          <div className="stat-chip">
            <span>Lobbies</span>
            <strong>{lobbies.length}</strong>
          </div>
        </div>
      </header>

      <section className="top-grid">
        <article className="panel config-panel">
          <div className="panel-head">
            <h2>Connection</h2>
            <button className="btn-ghost" onClick={saveConfig}>
              Save
            </button>
          </div>

          <label htmlFor="apiBase">API base URL</label>
          <input id="apiBase" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />

          <label htmlFor="token">Bearer token</label>
          <textarea id="token" value={token} onChange={(event) => setToken(event.target.value)} />

          <div className="inline-actions">
            <button onClick={handleAuthMe} disabled={!canCallProtectedApi || isLoading.auth}>
              {isLoading.auth ? "Loading..." : "Check /auth/me"}
            </button>
          </div>

          <label htmlFor="initData">Telegram initData</label>
          <textarea id="initData" value={initData} onChange={(event) => setInitData(event.target.value)} />
          <button onClick={handleTelegramLogin} disabled={isLoading.auth}>
            Telegram Login
          </button>

          <section className="test-lab">
            <div className="test-lab-head">
              <h3>TG Mock Test Users</h3>
              <span className="helper">dev only endpoint</span>
            </div>

            <label htmlFor="seedAmountMinor">Seed amount (minor, per currency)</label>
            <input
              id="seedAmountMinor"
              type="number"
              min="1"
              value={seedAmountMinor}
              onChange={(event) => setSeedAmountMinor(event.target.value)}
            />

            <div className="inline-actions test-actions">
              <button onClick={handleSeedTwoUsers} disabled={isLoading.auth || isLoading.wallet}>
                {isLoading.auth || isLoading.wallet ? "Seeding..." : "Seed 2 users"}
              </button>
              <button className="btn-ghost" onClick={() => setActiveTestUserKey("")}>
                Drop active
              </button>
            </div>

            <div className="test-user-list">
              {testUsers.map((entry) => {
                const tonValue = getBalanceValue(entry.balances, "TON", "availableMinor");
                const starsValue = getBalanceValue(entry.balances, "STARS", "availableMinor");
                const isActive = activeTestUserKey === entry.key;
                const isReady = Boolean(entry.accessToken);

                return (
                  <article key={entry.key} className={`test-user-card ${isActive ? "active" : ""}`}>
                    <div className="test-user-head">
                      <strong>{entry.label}</strong>
                      <span className={`tone ${isReady ? "ok" : "neutral"}`}>{isReady ? "ready" : "new"}</span>
                    </div>
                    <p className="test-user-line">@{entry.username} | id {entry.telegramId}</p>
                    <p className="test-user-line">
                      TON {formatMoney(tonValue)} | STARS {formatMoney(starsValue)}
                    </p>
                    <div className="inline-actions compact">
                      <button
                        className="btn-ghost"
                        onClick={() => void handleMockLoginUser(entry.key)}
                        disabled={isLoading.auth || isLoading.wallet}
                      >
                        Mock login
                      </button>
                      <button onClick={() => void handleTopUpTestUser(entry.key)} disabled={isLoading.wallet}>
                        Top up
                      </button>
                      <button className="btn-ghost" onClick={() => handleUseTestUser(entry.key)} disabled={!isReady}>
                        Use token
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <pre className={`out ${authOut.error ? "error" : ""}`}>{authOut.value || "No auth response yet"}</pre>
        </article>

        <article className="panel wallet-panel">
          <div className="panel-head">
            <h2>Wallet</h2>
            <button className="btn-ghost" onClick={handleBalances} disabled={!canCallProtectedApi || isLoading.wallet}>
              Refresh balances
            </button>
          </div>

          <div className="balance-grid">
            {CURRENCIES.map((currencyCode) => {
              const found = walletBalances.find((item) => item.currency === currencyCode);
              return (
                <div key={currencyCode} className="balance-card">
                  <p>{currencyCode}</p>
                  <h3>{formatMoney(found?.availableMinor)}</h3>
                  <small>locked: {formatMoney(found?.lockedMinor)}</small>
                </div>
              );
            })}
          </div>

          <div className="form-grid three">
            <div>
              <label htmlFor="walletCurrency">Currency</label>
              <select id="walletCurrency" value={walletCurrency} onChange={(event) => setWalletCurrency(event.target.value)}>
                {CURRENCIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="walletAmount">Amount (minor)</label>
              <input
                id="walletAmount"
                type="number"
                min="1"
                value={walletAmount}
                onChange={(event) => setWalletAmount(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="walletIdempotency">Idempotency key</label>
              <input
                id="walletIdempotency"
                value={walletIdempotency}
                onChange={(event) => setWalletIdempotency(event.target.value)}
              />
            </div>
          </div>

          <button onClick={handleDeposit} disabled={!canCallProtectedApi || isLoading.wallet}>
            {isLoading.wallet ? "Processing..." : "Mock Deposit"}
          </button>

          <pre className={`out ${walletOut.error ? "error" : ""}`}>{walletOut.value || "No wallet response yet"}</pre>
        </article>

        <article className="panel create-panel">
          <div className="panel-head">
            <h2>Create Lobby</h2>
            <span className="helper">Fast table setup</span>
          </div>

          <div className="form-grid three">
            <div>
              <label htmlFor="createCurrency">Currency</label>
              <select id="createCurrency" value={createCurrency} onChange={(event) => setCreateCurrency(event.target.value)}>
                {CURRENCIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="createStake">Stake (minor)</label>
              <input
                id="createStake"
                type="number"
                min="1"
                value={createStake}
                onChange={(event) => setCreateStake(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="createVisibility">Visibility</label>
              <select
                id="createVisibility"
                value={createVisibility}
                onChange={(event) => setCreateVisibility(event.target.value)}
              >
                {VISIBILITY.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label htmlFor="createAutoStart">Auto start</label>
          <select
            id="createAutoStart"
            value={createAutoStart ? "true" : "false"}
            onChange={(event) => setCreateAutoStart(event.target.value === "true")}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>

          <div className="inline-actions">
            <button onClick={handleCreateLobby} disabled={!canCallProtectedApi || isLoading.lobby}>
              {isLoading.lobby ? "Creating..." : "Create Lobby"}
            </button>
            <button className="btn-ghost" onClick={handleAutoJoin} disabled={!canCallProtectedApi || isLoading.lobby}>
              Auto Join
            </button>
          </div>

          <pre className={`out ${lobbyOut.error ? "error" : ""}`}>{lobbyOut.value || "No lobby response yet"}</pre>
        </article>
      </section>

      <section className="board-grid">
        <article className="panel lobby-list-panel">
          <div className="panel-head">
            <h2>Lobby Board</h2>
            <button className="btn-ghost" onClick={handleListLobbies} disabled={!canCallProtectedApi || isLoading.lobby}>
              Reload
            </button>
          </div>

          <div className="filters">
            <div>
              <label htmlFor="listOnlyJoinable">Only joinable</label>
              <select
                id="listOnlyJoinable"
                value={listOnlyJoinable}
                onChange={(event) => setListOnlyJoinable(event.target.value)}
              >
                <option value="true">true</option>
                <option value="">all</option>
              </select>
            </div>
            <div>
              <label htmlFor="listCurrencyFilter">Currency</label>
              <select
                id="listCurrencyFilter"
                value={listCurrencyFilter}
                onChange={(event) => setListCurrencyFilter(event.target.value)}
              >
                <option value="ALL">ALL</option>
                {CURRENCIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="joinCode">Join code</label>
              <input id="joinCode" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} />
            </div>
          </div>

          <div className="lobby-scroll">
            {visibleLobbies.length === 0 ? <p className="muted">No lobbies for current filter.</p> : null}
            {visibleLobbies.map((entry) => {
              const players = entry.participants?.length || 0;
              const maxPlayers = entry.maxPlayers || 2;
              const isActive = lobbyId.trim() === entry.id;

              return (
                <article key={entry.id} className={`lobby-card ${isActive ? "active" : ""}`}>
                  <div className="lobby-card-head">
                    <strong>{entry.publicId || entry.id.slice(0, 8)}</strong>
                    <span className={`tone ${statusTone(entry.status)}`}>{entry.status || "UNKNOWN"}</span>
                  </div>

                  <p className="lobby-line">
                    {entry.currency} | stake {formatMoney(entry.stakeMinor)} | {players}/{maxPlayers} players
                  </p>
                  <p className="lobby-line">visibility: {entry.visibility || "PUBLIC"}</p>

                  <div className="inline-actions compact">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        setLobbyId(entry.id);
                        void handleGetLobby(entry.id);
                      }}
                      disabled={!canCallProtectedApi || isLoading.lobby}
                    >
                      Open
                    </button>
                    <button onClick={() => void handleJoinLobby(entry.id)} disabled={!canCallProtectedApi || isLoading.lobby}>
                      Join
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => void handleLeaveLobby(entry.id)}
                      disabled={!canCallProtectedApi || isLoading.lobby}
                    >
                      Leave
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </article>

        <article className="panel arena-panel">
          <div className="panel-head">
            <h2>Lobby + Match Arena</h2>
            <span className="helper">Selected table and round controls</span>
          </div>

          <div className="selected-lobby">
            <label htmlFor="lobbyId">Selected lobby ID</label>
            <input id="lobbyId" value={lobbyId} onChange={(event) => setLobbyId(event.target.value)} />

            <div className="inline-actions compact">
              <button className="btn-ghost" onClick={() => void handleGetLobby()} disabled={!canCallProtectedApi || isLoading.lobby}>
                Pull lobby
              </button>
              <button onClick={() => void handleJoinLobby()} disabled={!canCallProtectedApi || isLoading.lobby}>
                Join lobby
              </button>
            </div>

            {selectedLobby ? (
              <div className="selected-meta">
                <p>
                  <span>Status</span>
                  <strong>{selectedLobby.status}</strong>
                </p>
                <p>
                  <span>Stake</span>
                  <strong>
                    {formatMoney(selectedLobby.stakeMinor)} {selectedLobby.currency}
                  </strong>
                </p>
                <p>
                  <span>Host</span>
                  <strong>{selectedLobby.hostUserId ? selectedLobby.hostUserId.slice(0, 10) : "-"}</strong>
                </p>
              </div>
            ) : (
              <p className="muted">No selected lobby details yet.</p>
            )}
          </div>

          <div className="match-section">
            <div className="form-grid two">
              <div>
                <label htmlFor="matchId">Match ID</label>
                <input id="matchId" value={matchId} onChange={(event) => setMatchId(event.target.value)} placeholder={liveMatchId || "auto from lobby"} />
              </div>
              <div>
                <label>Move</label>
                <div className="move-picker">
                  {MOVES.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={entry === move ? "move active" : "move"}
                      onClick={() => setMove(entry)}
                    >
                      {entry}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-grid two">
              <div>
                <label htmlFor="salt">Salt</label>
                <input id="salt" value={salt} onChange={(event) => setSalt(event.target.value)} />
              </div>
              <div>
                <label htmlFor="commitHash">Commit hash</label>
                <input id="commitHash" value={commitHash} onChange={(event) => setCommitHash(event.target.value)} />
              </div>
            </div>

            <div className="inline-actions">
              <button className="btn-ghost" onClick={() => setSalt(generateSalt())}>
                Generate salt
              </button>
              <button className="btn-ghost" onClick={handleBuildHash}>
                Build hash
              </button>
              <button onClick={handleGetMatch} disabled={!canCallProtectedApi || isLoading.match}>
                Pull match
              </button>
            </div>

            <div className="inline-actions">
              <button onClick={handleCommit} disabled={!canCallProtectedApi || isLoading.match || !commitHash.trim()}>
                Commit move
              </button>
              <button onClick={handleReveal} disabled={!canCallProtectedApi || isLoading.match || !salt.trim()}>
                Reveal move
              </button>
            </div>

            <pre className={`out ${matchOut.error ? "error" : ""}`}>{matchOut.value || "No match response yet"}</pre>
          </div>
        </article>
      </section>

      <section className="panel logs-panel">
        <div className="panel-head">
          <h2>Activity Log</h2>
          <button className="btn-ghost" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>

        <div className="log-list">
          {logs.length === 0 ? <p className="muted">No events yet.</p> : null}
          {logs.map((entry, index) => (
            <article key={`${entry.stamp}-${index}`} className="log-entry">
              <div className="log-head">
                <span className={`tone ${entry.level === "error" ? "bad" : "ok"}`}>{entry.level}</span>
                <time>{tinyDate(entry.stamp)}</time>
                <strong>{entry.text}</strong>
              </div>
              {entry.extra ? <pre className="out small">{toJson(entry.extra)}</pre> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
