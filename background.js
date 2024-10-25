chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false,
        preferHttps: true
    });
});

function validateProxyFormat(details) {
    if (!details) return false;
    const parts = details.split(':');
    if (parts.length < 2 || parts.length > 4) return false;
    
    const [host, port] = parts;
    // Validate IP address/hostname format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!ipRegex.test(host)) return false;
    
    // Validate port number
    const portNum = parseInt(port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) return false;
    
    return true;
}

// List of Twitch-related domains
const twitchDomains = [
    "*://*.twitch.tv/*",
    "*://*.ttvnw.net/*",        // Twitch CDN
    "*://*.jtvnw.net/*",        // Justin.tv/Twitch legacy CDN
    "*://twitchcdn.net/*",      // Additional Twitch CDN
    "*://*.twitchcdn.net/*",
    "*://twitch.map.fastly.net/*", // Fastly CDN used by Twitch
    "*://api.twitch.tv/*",      // Twitch API
    "*://gql.twitch.tv/*",      // Twitch GraphQL API
    "*://clips.twitch.tv/*",    // Twitch Clips
    "*://vod.twitch.tv/*",      // Twitch VODs
    "*://usher.ttvnw.net/*",    // Stream routing
    "*://video-edge*.jtvnw.net/*", // Video Edge servers
    "*://static.twitchcdn.net/*",  // Static content
    "*://static-cdn.jtvnw.net/*",  // Static CDN
    "*://video-weaver.*.hls.ttvnw.net/*", // HLS video servers
    "*://video-edge.*.abs.hls.ttvnw.net/*" // Alternative HLS servers
];

async function setProxy(details, enabled, preferHttps = true) {
    try {
        if (!enabled) {
            await chrome.proxy.settings.set({
                value: { mode: "direct" },
                scope: "regular"
            });
            return;
        }

        if (details && validateProxyFormat(details)) {
            const [host, port, username, password] = details.split(':');

            // Configure proxy settings with Twitch-specific rules
            const proxyConfig = {
                value: {
                    mode: "pac_script",
                    pacScript: {
                        data: `
                            function FindProxyForURL(url, host) {
                                // Twitch domains to proxy
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

                                // Check if the host matches any Twitch domain
                                for (let domain of twitchDomains) {
                                    if (host.endsWith(domain)) {
                                        return "PROXY ${host}:${port}";
                                    }
                                }

                                // Direct connection for all other traffic
                                return "DIRECT";
                            }
                        `
                    }
                },
                scope: "regular"
            };

            await chrome.proxy.settings.set(proxyConfig);

            // Set up authentication if credentials are provided
            if (username && password) {
                chrome.webRequest.onAuthRequired.removeListener(handleAuth); // Remove existing listener
                chrome.webRequest.onAuthRequired.addListener(
                    handleAuth,
                    { urls: twitchDomains },
                    ['asyncBlocking']
                );
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

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.proxyDetails || changes.proxyEnabled || changes.preferHttps) {
        chrome.storage.sync.get(
            ["proxyDetails", "proxyEnabled", "preferHttps"], 
            (data) => {
                setProxy(
                    data.proxyDetails, 
                    data.proxyEnabled, 
                    data.preferHttps
                );
            }
        );
    }
});