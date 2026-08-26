// x402 Provider Dashboard JavaScript

let apiKey = '';
let refreshInterval = null;
const REFRESH_INTERVAL_MS = 30000; // 30 seconds

// Get marketplace URL from meta tag, fallback to default
const marketplaceUrlMeta = document.querySelector('meta[name="marketplace-url"]');
const MARKETPLACE_URL = marketplaceUrlMeta && marketplaceUrlMeta.content
  ? marketplaceUrlMeta.content
  : "https://x402-sage.vercel.app";

// DOM Elements
const apiKeyInput = document.getElementById('api-key');
const submitKeyBtn = document.getElementById('submit-key');
const apiKeyStatus = document.getElementById('api-key-status');
const providerInfoLoading = document.getElementById('provider-info-loading');
const providerInfoContent = document.getElementById('provider-info-content');
const providerStatsLoading = document.getElementById('provider-stats-loading');
const providerStatsContent = document.getElementById('provider-stats-content');
const endpointsLoading = document.getElementById('endpoints-loading');
const endpointsContent = document.getElementById('endpoints-content');
const transactionsLoading = document.getElementById('transactions-loading');
const transactionsContent = document.getElementById('transactions-content');
const payoutsLoading = document.getElementById('payouts-loading');
const payoutsContent = document.getElementById('payouts-content');
const refreshBtn = document.getElementById('refresh-btn');

// Provider Info Elements
const providerName = document.getElementById('provider-name');
const providerEmail = document.getElementById('provider-email');
const providerWallet = document.getElementById('provider-wallet');
const providerStatus = document.getElementById('provider-status');

// Stats Elements
const statEndpointCount = document.getElementById('stat-endpoint-count');
const statTotalEarned = document.getElementById('stat-total-earned');
const statTotalCalls = document.getElementById('stat-total-calls');
const statBalancePending = document.getElementById('stat-balance-pending');

// Tables
const endpointsTableBody = document.querySelector('#endpoints-table tbody');
const transactionsTableBody = document.querySelector('#transactions-table tbody');
const payoutsTableBody = document.querySelector('#payouts-table tbody');

// Helper Functions
function showLoading(loadingEl, contentEl) {
    loadingEl.style.display = 'block';
    contentEl.style.display = 'none';
}

function hideLoading(loadingEl, contentEl) {
    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
}

function setStatus(statusEl, message, type = 'info') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
}

function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString();
}

// API Functions
async function fetchProviderInfo() {
    try {
        const response = await fetch(`${MARKETPLACE_URL}/api/providers/me`, {
            headers: {
                'X-API-Key': apiKey,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return await response.json();
    } catch (error) {
        throw new Error(`Failed to fetch provider info: ${error.message}`);
    }
}

async function fetchProviderStats() {
    try {
        const response = await fetch(`${MARKETPLACE_URL}/api/providers/me`, {
            headers: {
                'X-API-Key': apiKey,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return data.stats;
    } catch (error) {
        throw new Error(`Failed to fetch provider stats: ${error.message}`);
    }
}

async function fetchEndpoints() {
    try {
        const response = await fetch(`${MARKETPLACE_URL}/api/providers/me/endpoints`, {
            headers: {
                'X-API-Key': apiKey,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return data.endpoints || [];
    } catch (error) {
        throw new Error(`Failed to fetch endpoints: ${error.message}`);
    }
}

async function fetchTransactions() {
    try {
        const response = await fetch(`${MARKETPLACE_URL}/api/providers/me/transactions`, {
            headers: {
                'X-API-Key': apiKey,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return data.transactions || [];
    } catch (error) {
        throw new Error(`Failed to fetch transactions: ${error.message}`);
    }
}

async function fetchPayouts() {
    try {
        const response = await fetch(`${MARKETPLACE_URL}/api/providers/me/payouts`, {
            headers: {
                'X-API-Key': apiKey,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        return data.payouts || [];
    } catch (error) {
        throw new Error(`Failed to fetch payouts: ${error.message}`);
    }
}

// UI Update Functions
function updateProviderInfo(data) {
    providerName.textContent = data.name || 'N/A';
    providerEmail.textContent = data.email || 'N/A';
    providerWallet.textContent = formatAddress(data.walletAddress) || 'N/A';
    providerStatus.textContent = data.status || 'N/A';

    // Set status color
    if (data.status === 'active') {
        providerStatus.className = 'status success';
    } else if (data.status === 'paused') {
        providerStatus.className = 'status info';
    } else {
        providerStatus.className = 'status error';
    }
}

function updateProviderStats(stats) {
    statEndpointCount.textContent = stats.endpointCount || 0;
    statTotalEarned.textContent = `${(stats.totalEarnedUsdc || 0).toFixed(6)} USDC`;
    statTotalCalls.textContent = stats.totalCalls || 0;
    statBalancePending.textContent = `${(stats.balancePending || 0).toFixed(6)} USDC`;
}

function updateEndpointsTable(endpoints) {
    endpointsTableBody.innerHTML = '';

    if (endpoints.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="6" class="text-center">No endpoints found</td>`;
        endpointsTableBody.appendChild(row);
        return;
    }

    endpoints.forEach(endpoint => {
        const row = document.createElement('tr');
        row.className = 'endpoint-row';
        row.innerHTML = `
            <td>${endpoint.name || 'N/A'}</td>
            <td>${endpoint.slug || 'N/A'}</td>
            <td><span class="status ${endpoint.status === 'active' ? 'success' : endpoint.status === 'suspended' ? 'info' : 'error'}">${endpoint.status || 'N/A'}</span></td>
            <td>${(endpoint.price_display || '0')}</td>
            <td>${endpoint.total_calls || 0}</td>
            <td>${(endpoint.total_revenue || 0).toFixed(6)} USDC</td>
        `;
        endpointsTableBody.appendChild(row);
    });
}

function updateTransactionsTable(transactions) {
    transactionsTableBody.innerHTML = '';

    if (transactions.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="5" class="text-center">No transactions found</td>`;
        transactionsTableBody.appendChild(row);
        return;
    }

    transactions.forEach(tx => {
        const row = document.createElement('tr');
        const typeClass = tx.type === 'charge' ? 'charge' : 'payout';
        const typeText = tx.type === 'charge' ? 'Charge' : 'Payout';
        const amount = tx.type === 'charge' ? `-${tx.amount_usdc}` : `+${tx.amount_usdc}`;

        row.innerHTML = `
            <td><span class="transaction-type ${typeClass}">${typeText}</span></td>
            <td>${amount} USDC</td>
            <td>${tx.description || 'N/A'}</td>
            <td>${tx.endpoint_name || tx.endpoint_slug || 'N/A'}</td>
            <td>${formatTimestamp(tx.created_at)}</td>
        `;
        transactionsTableBody.appendChild(row);
    });
}

function updatePayoutsTable(payouts) {
    payoutsTableBody.innerHTML = '';

    if (payouts.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="4" class="text-center">No payouts found</td>`;
        payoutsTableBody.appendChild(row);
        return;
    }

    payouts.forEach(payout => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${(payout.amount_usdc || 0).toFixed(6)} USDC</td>
            <td><span class="status ${payout.status === 'completed' ? 'success' : payout.status === 'pending' ? 'info' : 'error'}">${payout.status || 'N/A'}</span></td>
            <td>${payout.period_start} to ${payout.period_end}</td>
            <td>${formatTimestamp(payout.sent_at)}</td>
        `;
        payoutsTableBody.appendChild(row);
    });
}

// Main Data Fetch Function
async function fetchAllData() {
    if (!apiKey) {
        setStatus(apiKeyStatus, 'Please enter your API key', 'error');
        return;
    }

    setStatus(apiKeyStatus, 'Fetching data...', 'info');

    try {
        // Fetch all data in parallel
        const [providerInfo, stats, endpoints, transactions, payouts] = await Promise.all([
            fetchProviderInfo(),
            fetchProviderStats(),
            fetchEndpoints(),
            fetchTransactions(),
            fetchPayouts()
        ]);

        // Update UI
        updateProviderInfo(providerInfo);
        hideLoading(providerInfoLoading, providerInfoContent);

        updateProviderStats(stats);
        hideLoading(providerStatsLoading, providerStatsContent);

        updateEndpointsTable(endpoints);
        hideLoading(endpointsLoading, endpointsContent);

        updateTransactionsTable(transactions);
        hideLoading(transactionsLoading, transactionsContent);

        updatePayoutsTable(payouts);
        hideLoading(payoutsLoading, payoutsContent);

        setStatus(apiKeyStatus, 'Data updated successfully', 'success');
    } catch (error) {
        console.error('Error fetching data:', error);
        setStatus(apiKeyStatus, `Error: ${error.message}`, 'error');

        // Hide loading states and show error in content areas
        hideLoading(providerInfoLoading, providerInfoContent);
        hideLoading(providerStatsLoading, providerStatsContent);
        hideLoading(endpointsLoading, endpointsContent);
        hideLoading(transactionsLoading, transactionsContent);
        hideLoading(payoutsLoading, payoutsContent);

        // Show error messages in content areas
        providerInfoContent.innerHTML = `<p class="error">Error loading provider info</p>`;
        providerStatsContent.innerHTML = `<p class="error">Error loading stats</p>`;
        endpointsContent.innerHTML = `<p class="error">Error loading endpoints</p>`;
        transactionsContent.innerHTML = `<p class="error">Error loading transactions</p>`;
        payoutsContent.innerHTML = `<p class="error">Error loading payouts</p>`;
    }
}

// Event Listeners
submitKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        apiKey = key;
        // Clear input for security
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'API key set';
        submitKeyBtn.disabled = true;

        setStatus(apiKeyStatus, 'API key set. Fetching data...', 'info');

        // Start auto-refresh
        if (refreshInterval) {
            clearInterval(refreshInterval);
        }
        fetchAllData();
        refreshInterval = setInterval(fetchAllData, REFRESH_INTERVAL_MS);
    } else {
        setStatus(apiKeyStatus, 'Please enter a valid API key', 'error');
    }
});

refreshBtn.addEventListener('click', () => {
    if (!apiKey) {
        setStatus(apiKeyStatus, 'Please set your API key first', 'error');
        return;
    }
    setStatus(apiKeyStatus, 'Refreshing data...', 'info');
    fetchAllData();
});

// Allow Enter key to submit
apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        submitKeyBtn.click();
    }
});

// Initialize
(function init() {
    // Check if we have an API key in localStorage (optional, for convenience)
    // const savedKey = localStorage.getItem('x402ApiKey');
    // if (savedKey) {
    //   apiKey = savedKey;
    //   apiKeyInput.value = '';
    //   apiKeyInput.placeholder = 'API key set from storage';
    //   submitKeyBtn.disabled = true;
    //   fetchAllData();
    //   refreshInterval = setInterval(fetchAllData, REFRESH_INTERVAL_MS);
    // }
})();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    // Optionally save API key to localStorage (uncomment if desired)
    // if (apiKey) {
    //   localStorage.setItem('x402ApiKey', apiKey);
    // }
});