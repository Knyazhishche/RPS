import { useMemo, useState } from "react";

const storageKeys = {
  apiBase: "rps_api_base",
  token: "rps_token",
};

function toJson(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
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

export default function App() {
  const [apiBase, setApiBase] = useState(() => localStorage.getItem(storageKeys.apiBase) || "http://localhost:3000");
  const [token, setToken] = useState(() => localStorage.getItem(storageKeys.token) || "");
  const [initData, setInitData] = useState("");

  const [walletCurrency, setWalletCurrency] = useState("TON");
  const [walletAmount, setWalletAmount] = useState("1000000");
  const [walletIdempotency, setWalletIdempotency] = useState("");

  const [createCurrency, setCreateCurrency] = useState("TON");
  const [createStake, setCreateStake] = useState("1000");
  const [createVisibility, setCreateVisibility] = useState("PUBLIC");
  const [createAutoStart, setCreateAutoStart] = useState(true);
  const [listOnlyJoinable, setListOnlyJoinable] = useState("");

  const [lobbyId, setLobbyId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [lobbies, setLobbies] = useState([]);

  const [matchId, setMatchId] = useState("");
  const [move, setMove] = useState("ROCK");
  const [salt, setSalt] = useState(() => generateSalt());
  const [commitHash, setCommitHash] = useState("");

  const [authOut, setAuthOut] = useState(makeOut());
  const [walletOut, setWalletOut] = useState(makeOut());
  const [lobbyOut, setLobbyOut] = useState(makeOut());
  const [matchOut, setMatchOut] = useState(makeOut());
  const [logs, setLogs] = useState([]);

  const canCallProtectedApi = useMemo(() => token.trim().length > 0, [token]);

  function appendLog(text, extra) {
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = extra ? `${stamp} ${text}\n${toJson(extra)}` : `${stamp} ${text}`;
    setLogs((prev) => [line, ...prev].slice(0, 200));
  }

  function saveConfig() {
    const normalizedApiBase = apiBase.trim().replace(/\/+$/, "");
    const trimmedToken = token.trim();

    setApiBase(normalizedApiBase);
    setToken(trimmedToken);
    localStorage.setItem(storageKeys.apiBase, normalizedApiBase);
    localStorage.setItem(storageKeys.token, trimmedToken);
    appendLog("Config saved", { apiBase: normalizedApiBase, tokenPresent: Boolean(trimmedToken) });
  }

  function setOut(setter, value, error = false) {
    setter(makeOut(toJson(value ?? "OK"), error));
  }

  async function api(path, options = {}) {
    const method = options.method || "GET";
    const normalizedApiBase = apiBase.trim().replace(/\/+$/, "");
    const trimmedToken = token.trim();
    const headers = {};

    if (options.auth !== false && trimmedToken) {
      headers.Authorization = `Bearer ${trimmedToken}`;
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

  async function runWithUi({ label, setter, request, onSuccess }) {
    try {
      const data = await request();
      setOut(setter, data, false);
      appendLog(`${label} success`, data);
      if (onSuccess) {
        onSuccess(data);
      }
      return data;
    } catch (error) {
      const details = error.payload || { message: error.message };
      setOut(setter, details, true);
      appendLog(`${label} failed`, details);
      return null;
    }
  }

  function fillLobbyAndMatch(data) {
    const lobby = data?.lobby || data;
    if (lobby?.id) {
      setLobbyId(lobby.id);
    }
    if (data?.matchId) {
      setMatchId(data.matchId);
      return;
    }
    if (lobby?.matches?.[0]?.id) {
      setMatchId(lobby.matches[0].id);
    }
  }

  async function handleSaveConfig() {
    saveConfig();
    setOut(setAuthOut, "Config saved.");
  }

  async function handleAuthMe() {
    await runWithUi({
      label: "auth/me",
      setter: setAuthOut,
      request: () => api("/api/auth/me"),
    });
  }

  async function handleTelegramLogin() {
    const body = { initData: initData.trim() };
    await runWithUi({
      label: "auth/telegram",
      setter: setAuthOut,
      request: () =>
        api("/api/auth/telegram", {
          method: "POST",
          auth: false,
          body,
        }),
      onSuccess: (data) => {
        if (data?.accessToken) {
          setToken(data.accessToken);
          localStorage.setItem(storageKeys.token, data.accessToken);
        }
      },
    });
  }

  async function handleDeposit() {
    await runWithUi({
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
  }

  async function handleBalances() {
    await runWithUi({
      label: "wallet/balances",
      setter: setWalletOut,
      request: () => api("/api/wallet/balances"),
    });
  }

  async function handleCreateLobby() {
    await runWithUi({
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
      onSuccess: fillLobbyAndMatch,
    });
  }

  async function handleListLobbies() {
    const query = new URLSearchParams();
    if (listOnlyJoinable) {
      query.set("onlyJoinable", listOnlyJoinable);
    }
    const path = query.toString() ? `/api/lobbies?${query}` : "/api/lobbies";

    await runWithUi({
      label: "lobbies/list",
      setter: setLobbyOut,
      request: () => api(path),
      onSuccess: (data) => {
        if (Array.isArray(data)) {
          setLobbies(data);
        } else {
          setLobbies([]);
        }
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
      label: `lobbies/get ${id}`,
      setter: setLobbyOut,
      request: () => api(`/api/lobbies/${encodeURIComponent(id)}`),
      onSuccess: fillLobbyAndMatch,
    });
  }

  async function handleJoinLobby(targetLobbyId = lobbyId) {
    const id = targetLobbyId.trim();
    if (!id) {
      setOut(setLobbyOut, { message: "Lobby ID is required" }, true);
      return;
    }
    await runWithUi({
      label: `lobbies/join ${id}`,
      setter: setLobbyOut,
      request: () =>
        api(`/api/lobbies/${encodeURIComponent(id)}/join`, {
          method: "POST",
          body: joinCode.trim() ? { joinCode: joinCode.trim() } : {},
        }),
      onSuccess: fillLobbyAndMatch,
    });
  }

  async function handleLeaveLobby(targetLobbyId = lobbyId) {
    const id = targetLobbyId.trim();
    if (!id) {
      setOut(setLobbyOut, { message: "Lobby ID is required" }, true);
      return;
    }
    await runWithUi({
      label: `lobbies/leave ${id}`,
      setter: setLobbyOut,
      request: () =>
        api(`/api/lobbies/${encodeURIComponent(id)}/leave`, {
          method: "POST",
        }),
      onSuccess: fillLobbyAndMatch,
    });
  }

  async function handleAutoJoin() {
    await runWithUi({
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
      onSuccess: fillLobbyAndMatch,
    });
  }

  async function handleBuildHash() {
    const nextHash = await sha256Hex(`${move}:${salt.trim()}`);
    setCommitHash(nextHash);
    appendLog("commit hash built", { move, salt: salt.trim(), commitHash: nextHash });
  }

  async function handleGetMatch() {
    const id = matchId.trim();
    if (!id) {
      setOut(setMatchOut, { message: "Match ID is required" }, true);
      return;
    }
    await runWithUi({
      label: `matches/get ${id}`,
      setter: setMatchOut,
      request: () => api(`/api/matches/${encodeURIComponent(id)}`),
    });
  }

  async function handleCommit() {
    const id = matchId.trim();
    if (!id) {
      setOut(setMatchOut, { message: "Match ID is required" }, true);
      return;
    }
    await runWithUi({
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
    const id = matchId.trim();
    if (!id) {
      setOut(setMatchOut, { message: "Match ID is required" }, true);
      return;
    }
    await runWithUi({
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
    <main className="wrap">
      <header>
        <h1>RPS Lobby Tester (React)</h1>
        <p className="hint">Open two tabs with different tokens to simulate two players.</p>
      </header>

      <section className="grid">
        <article className="card">
          <h2>Config + Auth</h2>
          <label htmlFor="apiBase">API base URL</label>
          <input id="apiBase" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />

          <label htmlFor="token">Bearer token</label>
          <textarea id="token" value={token} onChange={(event) => setToken(event.target.value)} />

          <div className="row">
            <button onClick={handleSaveConfig}>Save config</button>
            <button onClick={handleAuthMe} disabled={!canCallProtectedApi}>
              GET /api/auth/me
            </button>
          </div>

          <label htmlFor="initData">Telegram initData (optional)</label>
          <textarea id="initData" value={initData} onChange={(event) => setInitData(event.target.value)} />
          <button onClick={handleTelegramLogin}>POST /api/auth/telegram</button>

          <pre className={`out ${authOut.error ? "error" : ""}`}>{authOut.value}</pre>
        </article>

        <article className="card">
          <h2>Wallet</h2>

          <div className="row-3">
            <div>
              <label htmlFor="walletCurrency">Currency</label>
              <select id="walletCurrency" value={walletCurrency} onChange={(event) => setWalletCurrency(event.target.value)}>
                <option value="TON">TON</option>
                <option value="STARS">STARS</option>
              </select>
            </div>
            <div>
              <label htmlFor="walletAmount">Amount minor</label>
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

          <div className="row">
            <button onClick={handleDeposit} disabled={!canCallProtectedApi}>
              POST /wallet/deposit/mock
            </button>
            <button onClick={handleBalances} disabled={!canCallProtectedApi}>
              GET /wallet/balances
            </button>
          </div>

          <pre className={`out ${walletOut.error ? "error" : ""}`}>{walletOut.value}</pre>
        </article>
      </section>

      <section className="grid">
        <article className="card">
          <h2>Lobby</h2>

          <div className="row-3">
            <div>
              <label htmlFor="createCurrency">Currency</label>
              <select id="createCurrency" value={createCurrency} onChange={(event) => setCreateCurrency(event.target.value)}>
                <option value="TON">TON</option>
                <option value="STARS">STARS</option>
              </select>
            </div>
            <div>
              <label htmlFor="createStake">Stake minor</label>
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
                <option value="PUBLIC">PUBLIC</option>
                <option value="PRIVATE">PRIVATE</option>
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

          <div className="row">
            <button onClick={handleCreateLobby} disabled={!canCallProtectedApi}>
              POST /lobbies
            </button>
            <button onClick={handleListLobbies} disabled={!canCallProtectedApi}>
              GET /lobbies
            </button>
          </div>

          <div className="row-3">
            <div>
              <label htmlFor="lobbyId">Lobby ID</label>
              <input id="lobbyId" value={lobbyId} onChange={(event) => setLobbyId(event.target.value)} />
            </div>
            <div>
              <label htmlFor="joinCode">Join code</label>
              <input id="joinCode" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} />
            </div>
            <div>
              <label htmlFor="listOnlyJoinable">List only joinable</label>
              <select
                id="listOnlyJoinable"
                value={listOnlyJoinable}
                onChange={(event) => setListOnlyJoinable(event.target.value)}
              >
                <option value="">all</option>
                <option value="true">true</option>
              </select>
            </div>
          </div>

          <div className="row-3">
            <button onClick={() => handleGetLobby()} disabled={!canCallProtectedApi}>
              GET /lobbies/:id
            </button>
            <button onClick={() => handleJoinLobby()} disabled={!canCallProtectedApi}>
              POST /lobbies/:id/join
            </button>
            <button onClick={() => handleLeaveLobby()} disabled={!canCallProtectedApi}>
              POST /lobbies/:id/leave
            </button>
          </div>

          <div className="row">
            <button onClick={handleAutoJoin} disabled={!canCallProtectedApi}>
              POST /lobbies/auto-join
            </button>
            <button onClick={() => setLobbies([])}>Clear list</button>
          </div>

          <pre className={`out ${lobbyOut.error ? "error" : ""}`}>{lobbyOut.value}</pre>

          <div className="lobbies">
            {lobbies.length === 0 ? <p className="hint">No lobbies loaded.</p> : null}
            {lobbies.map((item) => (
              <div key={item.id} className="lobby-item">
                <p className="lobby-meta">
                  <strong>{item.id}</strong>
                  <br />
                  {item.currency} stake={item.stakeMinor} status={item.status} players={item.participants?.length ?? 0}/
                  {item.maxPlayers} visibility={item.visibility}
                  {item.joinCode ? ` joinCode=${item.joinCode}` : ""}
                </p>
                <div className="row-3">
                  <button onClick={() => handleGetLobby(item.id)} disabled={!canCallProtectedApi}>
                    Open
                  </button>
                  <button onClick={() => handleJoinLobby(item.id)} disabled={!canCallProtectedApi}>
                    Join
                  </button>
                  <button onClick={() => handleLeaveLobby(item.id)} disabled={!canCallProtectedApi}>
                    Leave
                  </button>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>Match</h2>
          <p className="hint">Use after lobby autostart when second player joins.</p>

          <div className="row">
            <div>
              <label htmlFor="matchId">Match ID</label>
              <input id="matchId" value={matchId} onChange={(event) => setMatchId(event.target.value)} />
            </div>
            <div>
              <label htmlFor="move">Move</label>
              <select id="move" value={move} onChange={(event) => setMove(event.target.value)}>
                <option value="ROCK">ROCK</option>
                <option value="PAPER">PAPER</option>
                <option value="SCISSORS">SCISSORS</option>
              </select>
            </div>
          </div>

          <div className="row">
            <div>
              <label htmlFor="salt">Salt</label>
              <input id="salt" value={salt} onChange={(event) => setSalt(event.target.value)} />
            </div>
            <div>
              <label htmlFor="commitHash">Commit hash</label>
              <input id="commitHash" value={commitHash} onChange={(event) => setCommitHash(event.target.value)} />
            </div>
          </div>

          <div className="row-3">
            <button onClick={() => setSalt(generateSalt())}>Generate salt</button>
            <button onClick={handleBuildHash}>Build hash</button>
            <button onClick={handleGetMatch} disabled={!canCallProtectedApi}>
              GET /matches/:id
            </button>
          </div>

          <div className="row">
            <button onClick={handleCommit} disabled={!canCallProtectedApi}>
              POST /matches/:id/commit
            </button>
            <button onClick={handleReveal} disabled={!canCallProtectedApi}>
              POST /matches/:id/reveal
            </button>
          </div>

          <pre className={`out ${matchOut.error ? "error" : ""}`}>{matchOut.value}</pre>
        </article>
      </section>

      <section className="card">
        <h2>Log</h2>
        <pre className="log">{logs.join("\n\n")}</pre>
      </section>
    </main>
  );
}
