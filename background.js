chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false,
        preferHttps: true,
        useSocks5: false,
        lastHealthCheck: null,
        lastKnownIP: null,
        proxyTimeout: 10000,
        maxRetries: 3,
        rateLimit: 100
    });
});

let requestCounts = {};
const RATE_LIMIT_WINDOW = 60000;

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
    "*://video-edge.abs.hls.ttvnw.net/*",
    "*://api.ipify.org/*"
];

async function checkProxyHealth(proxyDetails, useSocks5) {
    if (!proxyDetails) return { success: true, ip: null };

    try {
        // Allow proxy to fully initialize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        try {
            const response = await fetch('https://api.ipify.org?format=json', {
                method: 'GET',
                timeout: 10000
            });
            
            if (response.ok) {
                const data = await response.json();
                const timestamp = Date.now();
                chrome.storage.sync.set({ 
                    lastHealthCheck: timestamp,
                    lastKnownIP: data.ip 
                });
                
                const proxyHost = proxyDetails.split(':')[0];
                const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                if (ipRegex.test(proxyHost)) {
                    const isProxyIP = (data.ip === proxyHost);
                    return { 
                        success: true, 
                        ip: data.ip,
                        matched: isProxyIP
                    };
                }
                
                return { 
                    success: true, 
                    ip: data.ip,
                    matched: null
                };
            }
        } catch (ipError) {
            console.warn('IP verification failed:', ipError);
            
            try {
                const altResponse = await fetch('https://ifconfig.me/ip', {
                    method: 'GET',
                    timeout: 10000
                });
                
                if (altResponse.ok) {
                    const ip = await altResponse.text();
                    const timestamp = Date.now();
                    chrome.storage.sync.set({ 
                        lastHealthCheck: timestamp,
                        lastKnownIP: ip.trim() 
                    });
                    
                    const proxyHost = proxyDetails.split(':')[0];
                    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
                    if (ipRegex.test(proxyHost)) {
                        const isProxyIP = (ip.trim() === proxyHost);
                        return { 
                            success: true, 
                            ip: ip.trim(),
                            matched: isProxyIP
                        };
                    }
                    
                    return { 
                        success: true, 
                        ip: ip.trim(),
                        matched: null
                    };
                }
            } catch (altIpError) {
                console.warn('Alternative IP verification failed:', altIpError);
            }
        }
        
        throw new Error('Failed to verify proxy IP');
    } catch (error) {
        console.error('Health check error:', error);
        return { 
            success: false, 
            ip: null, 
            matched: null,
            error: error.message 
        };
    }
}

function checkRateLimit(domain) {
    const now = Date.now();
    if (!requestCounts[domain]) {
        requestCounts[domain] = [];
    }
    
    requestCounts[domain] = requestCounts[domain].filter(time => 
        now - time < RATE_LIMIT_WINDOW
    );
    
    if (requestCounts[domain].length >= 100) {
        return false;
    }
    
    requestCounts[domain].push(now);
    return true;
}

// Helper function to safely send messages
async function safeSendMessage(message) {
    try {
        // Check if there are any receivers (popup) open
        const receivers = await chrome.runtime.getContexts({
            contextTypes: ['POPUP']
        });
        
        if (receivers && receivers.length > 0) {
            chrome.runtime.sendMessage(message);
        } else {
            // Store the last status in storage for the popup to read when it opens
            if (message.type === 'proxyStatus') {
                chrome.storage.sync.set({
                    lastProxyStatus: {
                        ip: message.ip,
                        matched: message.matched,
                        timestamp: Date.now()
                    }
                });
            } else if (message.type === 'proxyError') {
                chrome.storage.sync.set({
                    lastProxyError: {
                        message: message.message,
                        timestamp: Date.now()
                    }
                });
            }
        }
    } catch (error) {
        console.log('Message sending skipped - no receivers');
    }
}

async function setProxy(details, enabled, preferHttps = true, useSocks5 = false) {
    try {
        if (!enabled) {
            await chrome.proxy.settings.set({
                value: { mode: "direct" },
                scope: "regular"
            });
            await safeSendMessage({ 
                type: 'proxyStatus', 
                ip: 'Direct Connection',
                matched: null
            });
            return;
        }

        if (details && validateProxyFormat(details, useSocks5)) {
            const parts = details.split(':');
            const [host, port] = parts;
            const username = parts[2];
            const password = parts[3];

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
                        mode: "fixed_servers",
                        rules: {
                            proxyForHttp: {
                                scheme: "http",
                                host: host,
                                port: parseInt(port)
                            },
                            proxyForHttps: {
                                scheme: "http",
                                host: host,
                                port: parseInt(port)
                            },
                            bypassList: ["localhost", "127.0.0.1"]
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

            chrome.webRequest.onErrorOccurred.addListener(
                handleRequestError,
                { urls: twitchDomains }
            );

            // Explicitly wait for proxy to be ready
            await new Promise(resolve => setTimeout(resolve, 2000));

            const healthCheck = await checkProxyHealth(details, useSocks5);
            if (healthCheck.ip) {
                await safeSendMessage({ 
                    type: 'proxyStatus', 
                    ip: healthCheck.ip,
                    matched: healthCheck.matched
                });
            }
            
            if (!healthCheck.success) {
                throw new Error('Proxy connection failed');
            }
        }
    } catch (error) {
        console.error('Proxy setup failed:', error);
        await safeSendMessage({ 
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