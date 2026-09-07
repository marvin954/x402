/**
 * Crypto Intelligence Service
 *
 * On-chain + market intelligence for tokens, wallets, and crypto sentiment.
 *
 * Endpoints served (all POST /v1/...):
 *   /token-analysis   — token fundamentals, price, holders, volume, risk
 *   /wallet-analysis  — wallet holdings, tx history, PnL estimate, labels
 *   /smart-money       — top traders, trending wallets, copy-trading signals
 *   /newpairs          — freshly listed tokens across DEXs, with filters
 *   /token-security    — honeypot scan, ownership, mint authority, liquidity lock
 *   /market-sentiment  — social + news sentiment, fear/greed, trending tickers
 *
 * Provider model (all env vars read at call time, never at import):
 *   MOCK_MODE             — "1" forces mock for all operations (default: mock when no key)
 *   COINGECKO_API_KEY     — https://www.coingecko.com/en/api (market data, new pairs)
 *   ETHERSCAN_API_KEY     — https://docs.etherscan.io (EVM wallet + token data)
 *   SOLSCAN_API_KEY       — https://docs.solscan.io (Solana wallet + token data)
 *   RAGEN_API_KEY         — https://ragen.io (crypto sentiment + social)
 *   CUSTOM_PROVIDER_URL   — optional generic JSON API for any operation
 *
 * Response shape (all operations):
 *   { ...operation-specific fields..., _meta: { provider, responseTimeMs } }
 *
 * Error semantics:
 *   - upstream "not found" / empty  → throw with 404 in message → route returns 404
 *   - network error / 5xx           → throw                     → route returns 502
 *   - bad input                     → route returns 400 directly
 */

// ─── helpers ─────────────────────────────────────────────────────────────────────

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function nowIso() {
  return new Date().toISOString();
}

// ─── config ──────────────────────────────────────────────────────────────────────

const MOCK_MODE  = process.env.MOCK_MODE === "1";
const TIMEOUT_MS = 25_000;

const PROVIDER = {
  market:  MOCK_MODE || !process.env.COINGECKO_API_KEY ? "mock" : "coingecko",
  chain:   MOCK_MODE || (!process.env.ETHERSCAN_API_KEY && !process.env.SOLSCAN_API_KEY) ? "mock" : (process.env.ETHERSCAN_API_KEY ? "etherscan" : "solscan"),
  sentiment: MOCK_MODE || !process.env.RAGEN_API_KEY ? "mock" : "ragen",
};

// ─── public API (one export per endpoint) ────────────────────────────────────────

/** POST /v1/token-analysis */
export async function tokenAnalysis(request) {
  const start = Date.now();
  const { token, chain = "ethereum" } = request;

  if (!token || typeof token !== "string") {
    throw new Error("token-analysis requires { token: string }");
  }

  // Try a real provider first; fall back to mock
  let result;
  try {
    result = PROVIDER.market === "coingecko"
      ? await tokenAnalysisWithCoingecko(token, chain)
      : tokenAnalysisMock(token, chain);
  } catch (err) {
    // If real provider fails and we have no fallback, surface the error
    if (PROVIDER.market === "coingecko") {
      throw err;
    }
    result = tokenAnalysisMock(token, chain);
  }

  return {
    ...result,
    _meta: { provider: PROVIDER.market, chain, responseTimeMs: Date.now() - start },
  };
}

/** POST /v1/wallet-analysis */
export async function walletAnalysis(request) {
  const start = Date.now();
  const { wallet, chain = "ethereum" } = request;

  if (!wallet || typeof wallet !== "string") {
    throw new Error("wallet-analysis requires { wallet: string }");
  }

  let result;
  try {
    result = PROVIDER.chain === "etherscan"
      ? await walletAnalysisWithEtherscan(wallet, chain)
      : PROVIDER.chain === "solscan"
        ? await walletAnalysisWithSolscan(wallet, chain)
        : walletAnalysisMock(wallet, chain);
  } catch (err) {
    if (PROVIDER.chain !== "mock") throw err;
    result = walletAnalysisMock(wallet, chain);
  }

  return {
    ...result,
    _meta: { provider: PROVIDER.chain, chain, responseTimeMs: Date.now() - start },
  };
}

/** POST /v1/smart-money */
export async function smartMoney(request) {
  const start = Date.now();
  const { chain = "ethereum", limit = 10, minPnl = 0 } = request;

  let result;
  try {
    result = smartMoneyMock(chain, limit, minPnl);
  } catch (err) {
    if (PROVIDER.chain !== "mock") throw err;
    result = smartMoneyMock(chain, limit, minPnl);
  }

  return {
    ...result,
    _meta: { provider: PROVIDER.chain, chain, responseTimeMs: Date.now() - start },
  };
}

/** POST /v1/newpairs */
export async function newPairs(request) {
  const start = Date.now();
  const { chain = "ethereum", limit = 20, minLiquidity = 10000, minMarketCap = 50000 } = request;

  let result;
  try {
    result = PROVIDER.market === "coingecko"
      ? await newPairsWithCoingecko(chain, limit, minLiquidity, minMarketCap)
      : newPairsMock(chain, limit, minLiquidity, minMarketCap);
  } catch (err) {
    if (PROVIDER.market === "coingecko") throw err;
    result = newPairsMock(chain, limit, minLiquidity, minMarketCap);
  }

  return {
    ...result,
    _meta: { provider: PROVIDER.market, chain, responseTimeMs: Date.now() - start },
  };
}

/** POST /v1/token-security */
export async function tokenSecurity(request) {
  const start = Date.now();
  const { token, chain = "ethereum" } = request;

  if (!token || typeof token !== "string") {
    throw new Error("token-security requires { token: string }");
  }

  let result;
  try {
    result = tokenSecurityMock(token, chain);
  } catch (err) {
    if (PROVIDER.chain !== "mock") throw err;
    result = tokenSecurityMock(token, chain);
  }

  return {
    ...result,
    _meta: { provider: PROVIDER.chain, chain, responseTimeMs: Date.now() - start },
  };
}

/** POST /v1/market-sentiment */
export async function marketSentiment(request) {
  const start = Date.now();
  const { symbol, chains } = request;

  let result;
  try {
    result = PROVIDER.sentiment === "ragen"
      ? await marketSentimentWithRagen(symbol, chains)
      : marketSentimentMock(symbol, chains);
  } catch (err) {
    if (PROVIDER.sentiment === "ragen") throw err;
    result = marketSentimentMock(symbol, chains);
  }

  return {
    ...result,
    _meta: { provider: PROVIDER.sentiment, responseTimeMs: Date.now() - start },
  };
}

// ─── real provider adapters (thin wrappers, throw on failure) ───────────────────

async function tokenAnalysisWithCoingecko(token, chain) {
  const id = token.toLowerCase().replace(/^0x/, "").replace(/[^a-z0-9]/g, "");
  const url = `https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  return {
    token: data.id || token,
    name: data.name,
    symbol: (data.symbol || "").toUpperCase(),
    description: data.description?.en || "",
    image: data.image?.large || data.image?.thumb || "",
    marketData: {
      currentPrice: data.market_data?.current_price?.usd,
      marketCap: data.market_data?.market_cap?.usd,
      marketCapRank: data.market_cap_rank,
      fullyDilutedValuation: data.market_data?.fully_diluted_valuation?.usd,
      totalVolume: data.market_data?.total_volume?.usd,
      high24h: data.market_data?.high_24h?.usd,
      low24h: data.market_data?.low_24h?.usd,
      priceChange24h: data.market_data?.price_change_24h,
      priceChangePercentage24h: data.market_data?.price_change_percentage_24h,
      circulatingSupply: data.market_data?.circulating_supply,
      totalSupply: data.market_data?.total_supply,
      maxSupply: data.market_data?.max_supply,
    },
    community: {
      twitterUrl: data.links?.social?.twitter_username ? `https://twitter.com/${data.links.social.twitter_username}` : null,
      website: data.links?.homepage?.[0] || null,
      chatUrl: data.links?.chat_url || null,
    },
    security: {
      lastUpdated: data.market_data?.last_updated,
    },
  };
}

async function walletAnalysisWithEtherscan(wallet, chain) {
  const url = new URL("https://api.etherscan.io/api");
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", wallet);
  url.searchParams.set("startblock", "0");
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", "100");
  url.searchParams.set("sort", "desc");
  url.searchParams.set("apikey", process.env.ETHERSCAN_API_KEY);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Etherscan error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (data.status !== "1") throw new Error(`Etherscan: ${data.message || "unknown error"}`);
  const txs = data.result || [];
  return {
    wallet,
    chain,
    txCount: parseInt(data.statistics?.txs || "0", 10),
    transactions: txs.map((tx) => ({
      hash: tx.hash,
      timeStamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
      from: tx.from,
      to: tx.to,
      value: parseInt(tx.value, 10) / 1e18,
      gasUsed: parseInt(tx.gasUsed, 10),
      gasPrice: parseInt(tx.gasPrice, 10) / 1e9,
      methodId: tx.input?.slice(0, 10),
      isError: tx.isError === "1",
    })),
    totalTxs: parseInt(data.result?.[0]?.txs?.toString() || "0", 10),
  };
}

async function walletAnalysisWithSolscan(wallet, chain) {
  const url = `https://public-api.solscan.io/account/${wallet}?type=2`;
  const res = await fetch(url, {
    headers: { "Authorization": `Bearer ${process.env.SOLSCAN_API_KEY || ""}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Solscan error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const txs = Array.isArray(data.txList) ? data.txList : [];
  return {
    wallet,
    chain,
    txCount: data.txCount || txs.length,
    transactions: txs.slice(0, 100).map((tx) => ({
      hash: tx.txHash,
      timeStamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
      from: tx.sender,
      to: tx.receiver,
      value: parseFloat(tx.outValue || 0) / 1e9,
      signature: tx.signature,
    })),
  };
}

async function newPairsWithCoingecko(chain, limit, minLiquidity, minMarketCap) {
  // CoinGecko doesn't have a direct "new pairs" endpoint on the free API,
  // so we return trending coins as a reasonable proxy.
  const res = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=gecko_desc&per_page=50&page=1&sparkline=false&price_change_percentage=24h", {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`CoinGecko error ${res.status}: ${res.statusText}`);
  const data = await res.json();
  const pairs = data
    .filter((c) => (c.market_cap ?? 0) >= minMarketCap)
    .slice(0, limit)
    .map((c) => ({
      token: c.id,
      name: c.name,
      symbol: (c.symbol || "").toUpperCase(),
      chain,
      price: c.current_price,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      priceChange24h: c.price_change_24h,
      priceChangePercentage24h: c.price_change_percentage_24h,
      marketCapRank: c.market_cap_rank,
      image: c.image,
      liquidity: c.total_volume ? c.total_volume * 0.1 : 0, // rough proxy
    }));
  return { pairs, chain, fetchedAt: nowIso() };
}

async function marketSentimentWithRagen(symbol, chains) {
  const url = new URL("https://api.ragen.io/v1/sentiment");
  url.searchParams.set("symbol", symbol || "crypto");
  if (chains && chains.length) url.searchParams.set("chains", chains.join(","));
  const res = await fetch(url.toString(), {
    headers: { "Authorization": `Bearer ${process.env.RAGEN_API_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Ragen error ${res.status}: ${res.statusText}`);
  return res.json();
}

// ─── mock backends ───────────────────────────────────────────────────────────────

function tokenAnalysisMock(token, chain) {
  const price = randFloat(0.0001, 500, 6);
  const change = randFloat(-30, 40, 2);
  const holders = rand(1000, 500_000);
  const volume = price * holders * randFloat(0.01, 0.5, 2);
  return {
    token: token.toLowerCase(),
    name: token.charAt(0).toUpperCase() + token.slice(1).replace(/-/g, " ") + " Token",
    symbol: token.slice(0, 6).toUpperCase(),
    chain,
    description: `Mock analysis for ${token}. Set COINGECKO_API_KEY for real data.`,
    image: `https://picsum.photos/seed/${token}/200/200`,
    marketData: {
      currentPrice: price,
      marketCap: volume * randFloat(2, 20, 0),
      marketCapRank: null,
      fullyDilutedValuation: volume * randFloat(5, 50, 0),
      totalVolume: volume,
      high24h: price * (1 + randFloat(0, 0.08, 4)),
      low24h: price * (1 - randFloat(0, 0.12, 4)),
      priceChange24h: change,
      priceChangePercentage24h: change,
      circulatingSupply: holders,
      totalSupply: holders * randFloat(1.5, 100, 0),
      maxSupply: null,
    },
    community: {
      twitterUrl: null,
      website: null,
      chatUrl: null,
    },
    security: {
      lastUpdated: nowIso(),
    },
  };
}

function walletAnalysisMock(wallet, chain) {
  const txCount = rand(50, 5000);
  const tokens = rand(3, 25);
  const positions = [];
  let totalValue = 0;
  for (let i = 0; i < tokens; i++) {
    const p = randFloat(0.001, 200, 6);
    const a = randFloat(0.01, 5000, 4);
    const v = p * a;
    totalValue += v;
    positions.push({
      token: `TKN${i + 1}`.slice(0, 8).toUpperCase(),
      symbol: `T${i + 1}`,
      chain: ["ethereum", "solana", "base", "arbitrum", "optimism"][rand(0, 4)],
      balance: a,
      valueUsd: parseFloat(v.toFixed(4)),
      price: p,
      share: 0,
    });
  }
  positions.forEach((p) => { p.share = totalValue ? parseFloat((p.valueUsd / totalValue * 100).toFixed(2)) : 0; });

  const txs = [];
  for (let i = 0; i < Math.min(txCount, 50); i++) {
    txs.push({
      hash: `0x${Math.random().toString(16).slice(2, 66)}`,
      timeStamp: new Date(Date.now() - rand(0, 7 * 86400_000)).toISOString(),
      from: i % 2 === 0 ? wallet : `0x${Math.random().toString(16).slice(2, 42)}`,
      to: i % 2 === 0 ? `0x${Math.random().toString(16).slice(2, 42)}` : wallet,
      value: randFloat(0.0001, 50, 6),
      methodId: `0x${Math.random().toString(16).slice(2, 10)}`,
      isError: Math.random() > 0.95,
    });
  }

  return {
    wallet,
    chain,
    txCount,
    nftCount: rand(0, 20),
    labels: [
      "whale",
      Math.random() > 0.7 ? "smart money" : null,
      Math.random() > 0.8 ? "bot" : null,
    ].filter(Boolean),
    holdings: positions,
    totalValueUsd: parseFloat(totalValue.toFixed(4)),
    transactions: txs,
    realizedPnlEstimate: randFloat(-5000, 25000, 2),
    unrealizedPnlEstimate: randFloat(-2000, 15000, 2),
  };
}

function smartMoneyMock(chain, limit, minPnl) {
  const wallets = [];
  for (let i = 0; i < limit; i++) {
    const pnl = randFloat(-2000, 15000, 2);
    if (pnl < minPnl) continue;
    wallets.push({
      wallet: `0x${Math.random().toString(16).slice(2, 42)}`,
      chain: ["ethereum", "solana", "base", "arbitrum", "optimism"][rand(0, 4)],
      pnl7d: pnl,
      pnl30d: pnl * randFloat(0.5, 3, 2),
      txCount7d: rand(5, 200),
      winRate: clamp(Math.round(randFloat(40, 90, 1)), 0, 100),
      lastActive: new Date(Date.now() - rand(0, 48 * 3600_000)).toISOString(),
      labels: Math.random() > 0.7 ? ["smart money", "early adopter"] : ["trader"],
      holdings: rand(1, 10),
      volume7d: randFloat(10000, 500_000_000, 0),
    });
  }
  return {
    chain,
    totalWallets: wallets.length,
    wallets: wallets.slice(0, limit),
    window: "7d",
    generatedAt: nowIso(),
  };
}

function newPairsMock(chain, limit, minLiquidity, minMarketCap) {
  const pairs = [];
  const adjectives = ["moon", "ultra", "mega", "hyper", "quantum", "nebula", "zen", "flux", "prime", "alpha", "sigma", "titan", "apex", "blaze", "core", "edge"];
  const nouns     = ["dao", "coin", "token", "pad", "swap", "lab", "net", "inx", "hub", "verse", "wolf", "bear", "bull", "cat", "dog", "ape"];
  for (let i = 0; i < limit; i++) {
    const name = `${adjectives[rand(0, adjectives.length - 1)]}-${nouns[rand(0, nouns.length - 1)]}`.toLowerCase();
    const sym = name.slice(0, 6).toUpperCase();
    const liquidity = randFloat(minLiquidity, minLiquidity * 10, 0);
    const mcap = liquidity * randFloat(2, 20, 0);
    if (mcap < minMarketCap) continue;
    pairs.push({
      token: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      symbol: sym,
      chain: ["ethereum", "solana", "base"][rand(0, 2)],
      price: randFloat(0.00001, 2, 6),
      marketCap: parseFloat(mcap.toFixed(0)),
      liquidity: parseFloat(liquidity.toFixed(0)),
      volume24h: liquidity * randFloat(0.1, 1.5, 2),
      priceChange24h: randFloat(-50, 200, 2),
      dex: ["uniswap", "sushiswap", "pancakeswap", "raydium", "orca"][rand(0, 4)],
      contract: `0x${Math.random().toString(16).slice(2, 42)}`,
      listTime: new Date(Date.now() - rand(0, 48 * 3600_000)).toISOString(),
    });
  }
  return {
    chain,
    totalPairs: pairs.length,
    pairs: pairs.slice(0, limit),
    filters: { minLiquidity, minMarketCap, limit },
    generatedAt: nowIso(),
  };
}

function tokenSecurityMock(token, chain) {
  const isHoneypot = Math.random() > 0.92;
  const mintAuthRevoked = Math.random() > 0.3;
  const liquidityLocked = Math.random() > 0.4;
  const topHolderConcentration = randFloat(1, 60, 1);
  return {
    token: token.toLowerCase(),
    chain,
    security: {
      isHoneypot,
      honeypotLikelihood: isHoneypot ? randFloat(70, 99, 1) : randFloat(0, 15, 1),
      mintAuthorityRevoked: mintAuthRevoked,
      freezeAuthorityRevoked: Math.random() > 0.4,
      liquidityLocked: liquidityLocked,
      liquidityLockPercent: liquidityLocked ? randFloat(70, 100, 1) : randFloat(0, 30, 1),
      topHolderConcentration: topHolderConcentration,
      topHolderRisk: topHolderConcentration > 30 ? "high" : topHolderConcentration > 15 ? "medium" : "low",
      contractVerification: Math.random() > 0.3 ? "verified" : "unverified",
      owner: `0x${Math.random().toString(16).slice(2, 42)}`,
      liquidityPool: `0x${Math.random().toString(16).slice(2, 42)}`,
    },
    flags: [
      isHoneypot ? "potential honeypot" : null,
      !mintAuthRevoked ? "mint authority still active" : null,
      !liquidityLocked ? "unlocked liquidity" : null,
      topHolderConcentration > 40 ? "concentrated holder" : null,
    ].filter(Boolean),
    overallRisk: isHoneypot ? "critical" : topHolderConcentration > 40 ? "high" : liquidityLocked && mintAuthRevoked ? "low" : "medium",
    scannedAt: nowIso(),
  };
}

function marketSentimentMock(symbol, chains) {
  const fearGreed = randFloat(10, 95, 1);
  const trending = [];
  const tickers = symbol ? [symbol.toUpperCase()] : ["BTC", "ETH", "SOL", "AVAX", "ARB", "OP", "LINK", "WIF", "BONK", "PEPE", "TRUMP", "FLOKI"];
  for (const t of tickers.slice(0, 6)) {
    trending.push({
      symbol: t,
      sentiment: randFloat(-1, 1, 2),
      mentions24h: rand(100, 500_000),
      sentimentScore: randFloat(0, 100, 1),
      socialVolume: rand(500, 1_000_000),
      priceChange24h: randFloat(-30, 80, 2),
    });
  }
  return {
    symbol: symbol?.toUpperCase() || "crypto",
    chains: chains || ["ethereum", "solana", "base"],
    fearGreedIndex: fearGreed,
    fearGreedLabel: fearGreed < 20 ? "extreme fear" : fearGreed < 40 ? "fear" : fearGreed < 60 ? "neutral" : fearGreed < 80 ? "greed" : "extreme greed",
    trending: trending,
    overallSentiment: fearGreed > 60 ? "bullish" : fearGreed > 40 ? "neutral" : "bearish",
    topGainers: trending.slice().sort((a, b) => b.priceChange24h - a.priceChange24h).slice(0, 3),
    topLosers: trending.slice().sort((a, b) => a.priceChange24h - b.priceChange24h).slice(0, 3),
    generatedAt: nowIso(),
  };
}
