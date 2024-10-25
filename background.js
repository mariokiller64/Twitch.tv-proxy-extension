chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false,
        preferHttps: true,
        useSocks5: false
    });
});

function validateProxyFormat(details, isSocks5) {
    if (!details) return false;
    const parts = details.split(':');
    
    // SOCKS5 only accepts IP:PORT format
    if (isSocks5 && parts.length !== 2) return false;
    // HTTP/HTTPS accepts either IP:PORT or IP:PORT:USERNAME:PASSWORD
    if (!isSocks5 && parts.length !== 2 && parts.length !== 4) return false;
    
    const [host, port] = parts;
    // Validate IP address/hostname format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    if (!ipRegex.test(host)) return false;
    
    // Validate port number
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

            if (useSocks5) {
                // SOCKS5 configuration
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
                // Remove auth listener for SOCKS5
                chrome.webRequest.onAuthRequired.removeListener(handleAuth);
            } else {
                // HTTP/HTTPS configuration
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

                // Set up authentication only if credentials are provided - KEEPING YOUR ORIGINAL WORKING CODE
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
        }
    } catch (error) {
        console.error('Proxy setup failed:', error);
        chrome.runtime.sendMessage({ 
            type: 'proxyError', 
            message: error.message 
        });
    }
}

// Keeping your original handleAuth function intact
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