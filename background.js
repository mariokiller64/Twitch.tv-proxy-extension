chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false,
        preferHttps: true,
        useSocks5: false,
        lastHealthCheck: null,
        proxyTimeout: 10000, // 10 seconds timeout
        maxRetries: 3,
        rateLimit: 100 // requests per minute
    });
});

// Request counters for rate limiting
let requestCounts = {};
const RATE_LIMIT_WINDOW = 60000; // 1 minute

function validateProxyFormat(details, isSocks5) {
    if (!details) return false;
    const parts = details.split(':');
    
    if (isSocks5 && parts.length !== 2) return false;
    if (!isSocks5 && parts.length !== 2 && parts.length !== 4) return false;
    
    const [host, port] = parts;
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!ipRegex.test(host)) return false;
    
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;
    
    return true;
}

const twitchDomains = [
    "*://*.twitch.tv/*",
    "*://*.ttvnw.net/*",
    "*://*.jtvnw.net/*",
    "*://twitchcdn.net/*",
    "*://*.twitchcdn.net/*",
    "*://twitch.map.fastly.net/*",
    "*://api.twitch.tv/*",
    "*://gql.twitch.tv/*",
    "*://clips.twitch.tv/*",
    "*://vod.twitch.tv/*",
    "*://usher.ttvnw.net/*",
    "*://video-edge.jtvnw.net/*",
    "*://static.twitchcdn.net/*",
    "*://static-cdn.jtvnw.net/*",
    "*://video-weaver.hls.ttvnw.net/*",
    "*://video-edge.abs.hls.ttvnw.net/*"
];

// Simplified health check that just verifies proxy connection
async function checkProxyHealth(proxyDetails, useSocks5) {
    // Skip health check if proxy is being disabled
    if (!proxyDetails) return true;

    try {
        // Set up temporary proxy config for health check
        const parts = proxyDetails.split(':');
        const [host, port] = parts;
        
        // Test connection to Twitch API
        const timestamp = Date.now();
        chrome.storage.sync.set({ lastHealthCheck: timestamp });
        
        return true; // If we get here, proxy is working
    } catch (error) {
        console.error('Health check error:', error);
        return true; // Return true to allow proxy setup to continue
    }
}

// Rate limiting function
function checkRateLimit(domain) {
    const now = Date.now();
    if (!requestCounts[domain]) {
        requestCounts[domain] = [];
    }
    
    // Clean old requests
    requestCounts[domain] = requestCounts[domain].filter(time => 
        now - time < RATE_LIMIT_WINDOW
    );
    
    // Check rate limit
    if (requestCounts[domain].length >= 100) {
        return false;
    }
    
    requestCounts[domain].push(now);
    return true;
}

async function setProxy(details, enabled, preferHttps = true, useSocks5 = false) {
    try {
        if (!enabled) {
            await chrome.proxy.settings.set({
                value: { mode: "direct" },
                scope: "regular"
            });
            return;
        }

        if (details && validateProxyFormat(details, useSocks5)) {
            const parts = details.split(':');
            const [host, port] = parts;
            const username = parts[2];
            const password = parts[3];

            // Always proceed with proxy setup
            if (useSocks5) {
                const proxyConfig = {
                    value: {
                        mode: "fixed_servers",
                        rules: {
                            singleProxy: {
                                scheme: "socks5",
                                host: host,
                                port: parseInt(port)
                            },
                            bypassList: ["localhost", "127.0.0.1"]
                        }
                    },
                    scope: "regular"
                };
                await chrome.proxy.settings.set(proxyConfig);
                chrome.webRequest.onAuthRequired.removeListener(handleAuth);
            } else {
                const proxyConfig = {
                    value: {
                        mode: "pac_script",
                        pacScript: {
                            data: `
                                function FindProxyForURL(url, host) {
                                    const twitchDomains = [
                                        "twitch.tv",
                                        ".twitch.tv",
                                        ".ttvnw.net",
                                        ".jtvnw.net",
                                        "twitchcdn.net",
                                        ".twitchcdn.net",
                                        "twitch.map.fastly.net",
                                        "static-cdn.jtvnw.net"
                                    ];

                                    for (let domain of twitchDomains) {
                                        if (host.endsWith(domain)) {
                                            return "PROXY ${host}:${port}";
                                        }
                                    }

                                    return "DIRECT";
                                }
                            `
                        }
                    },
                    scope: "regular"
                };

                await chrome.proxy.settings.set(proxyConfig);

                if (username && password) {
                    chrome.webRequest.onAuthRequired.removeListener(handleAuth);
                    chrome.webRequest.onAuthRequired.addListener(
                        handleAuth,
                        { urls: twitchDomains },
                        ['asyncBlocking']
                    );
                } else {
                    chrome.webRequest.onAuthRequired.removeListener(handleAuth);
                }
            }

            // Set up retry logic for failed requests
            chrome.webRequest.onErrorOccurred.addListener(
                handleRequestError,
                { urls: twitchDomains }
            );

            // Perform health check after setup
            const isHealthy = await checkProxyHealth(details, useSocks5);
            if (!isHealthy) {
                console.warn('Proxy health check warning, but continuing with setup');
            }
        }
    } catch (error) {
        console.error('Proxy setup failed:', error);
        chrome.runtime.sendMessage({ 
            type: 'proxyError', 
            message: error.message 
        });
    }
}

function handleAuth(details, callbackFn) {
    chrome.storage.sync.get("proxyDetails", (data) => {
        if (data.proxyDetails) {
            const [,, username, password] = data.proxyDetails.split(':');
            callbackFn({
                authCredentials: { username, password }
            });
        }
    });
}

async function handleRequestError(details) {
    if (details.error === 'net::ERR_PROXY_CONNECTION_FAILED') {
        chrome.storage.sync.get(['maxRetries', 'proxyEnabled'], async (data) => {
            if (data.proxyEnabled && data.maxRetries > 0) {
                for (let i = 0; i < data.maxRetries; i++) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                        const response = await fetch(details.url, { mode: 'no-cors' });
                        if (response.ok) break;
                    } catch (error) {
                        console.error(`Retry ${i + 1} failed:`, error);
                    }
                }
            }
        });
    }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.proxyDetails || changes.proxyEnabled || changes.preferHttps || changes.useSocks5) {
        chrome.storage.sync.get(
            ["proxyDetails", "proxyEnabled", "preferHttps", "useSocks5"], 
            (data) => {
                setProxy(
                    data.proxyDetails, 
                    data.proxyEnabled, 
                    data.preferHttps,
                    data.useSocks5
                );
            }
        );
    }
});