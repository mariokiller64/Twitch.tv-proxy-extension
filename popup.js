document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    initializeSpeedTest();
});

function loadSettings() {
    chrome.storage.sync.get(
        [
            "proxyDetails", 
            "proxyHistory", 
            "proxyEnabled", 
            "preferHttps", 
            "useSocks5", 
            "lastHealthCheck", 
            "lastKnownIP",
            "lastProxyStatus",
            "lastProxyError"
        ], 
        (data) => {
            document.getElementById("proxy-input").value = data.proxyDetails || '';
            document.getElementById("enable-proxy").checked = !!data.proxyEnabled;
            document.getElementById("prefer-https").checked = 
                data.preferHttps !== undefined ? data.preferHttps : true;
            document.getElementById("use-socks5").checked = !!data.useSocks5;
            displayHistory(data.proxyHistory || []);
            updateInputPlaceholder();
            
            // Handle stored status messages
            if (data.lastProxyStatus) {
                const timeSinceStatus = Date.now() - data.lastProxyStatus.timestamp;
                if (timeSinceStatus < 30000) { // Show if less than 30 seconds old
                    const statusMsg = data.lastProxyStatus.matched === true ? 
                        `Proxy Status\nIP: ${data.lastProxyStatus.ip}\nStatus: Verified` :
                        data.lastProxyStatus.matched === false ?
                        `Proxy Status\nIP: ${data.lastProxyStatus.ip}\nStatus: Warning - IP Mismatch` :
                        `Proxy Status\nIP: ${data.lastProxyStatus.ip}\nStatus: Active`;
                    
                    showStatus(statusMsg, data.lastProxyStatus.matched === false ? 'warning' : 'success', 1500);
                }
            } else if (data.lastHealthCheck && data.lastKnownIP) {
                updateProxyStatus(data.lastHealthCheck, data.lastKnownIP);
            }
            
            if (data.lastProxyError) {
                const timeSinceError = Date.now() - data.lastProxyError.timestamp;
                if (timeSinceError < 30000) { // Show if less than 30 seconds old
                    showStatus(data.lastProxyError.message, 'error', 5000);
                }
            }
        }
    );
}

function updateProxyStatus(lastHealthCheck, lastKnownIP) {
    const statusEl = document.getElementById("status-indicator");
    if (!statusEl) return;

    if (!lastHealthCheck || !lastKnownIP) {
        statusEl.textContent = "Status: No Proxy Active";
        statusEl.className = "status-unknown";
        return;
    }

    const timeSinceCheck = Date.now() - lastHealthCheck;
    if (timeSinceCheck < 300000) {
        statusEl.textContent = `Connected - IP: ${lastKnownIP}`;
        statusEl.className = "status-connected";
    } else {
        statusEl.textContent = "Status: Check Required";
        statusEl.className = "status-warning";
    }
}

function initializeSpeedTest() {
    const speedTestBtn = document.createElement("button");
    speedTestBtn.id = "speed-test";
    speedTestBtn.textContent = "Test Speed";
    speedTestBtn.className = "speed-test-button";
    speedTestBtn.addEventListener("click", runSpeedTest);
    document.querySelector(".button-group").appendChild(speedTestBtn);
}

async function runSpeedTest() {
    const startTime = Date.now();
    try {
        // Get current IP
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        if (!ipResponse.ok) throw new Error('Failed to get IP');
        const ipData = await ipResponse.json();
        
        // Get proxy status
        chrome.storage.sync.get("proxyEnabled", async (data) => {
            const proxyStatus = data.proxyEnabled ? "Proxy Enabled" : "Direct Connection";
            
            // Just measure latency to a reliable endpoint instead of Twitch
            const latencyResponse = await fetch('https://api.ipify.org/check', {
                method: 'HEAD'
            });
            const endTime = Date.now();
            const latency = endTime - startTime;
            
            showStatus(
                `Speed Test Results\nConnection: ${proxyStatus}\nIP: ${ipData.ip}\nLatency: ${latency}ms`, 
                latency < 200 ? 'success' : 'warning',
                1500
            );
        });
    } catch (error) {
        console.error('Speed test error:', error);
        showStatus(`Speed test failed - ${error.message}`, 'error', 1500);
    }
}

document.getElementById("enable-proxy").addEventListener("change", (e) => {
    chrome.storage.sync.set({ proxyEnabled: e.target.checked });
});

document.getElementById("prefer-https").addEventListener("change", (e) => {
    chrome.storage.sync.set({ preferHttps: e.target.checked });
});

document.getElementById("use-socks5").addEventListener("change", (e) => {
    chrome.storage.sync.set({ useSocks5: e.target.checked });
    updateInputPlaceholder();
});

function updateInputPlaceholder() {
    const proxyInput = document.getElementById("proxy-input");
    const useSocks5 = document.getElementById("use-socks5").checked;
    
    if (useSocks5) {
        proxyInput.placeholder = "IP:PORT (SOCKS5)";
    } else {
        proxyInput.placeholder = "IP:PORT or IP:PORT:USERNAME:PASSWORD";
    }
}

document.getElementById("apply-button").addEventListener("click", () => {
    const proxyInput = document.getElementById("proxy-input").value;
    const enableProxy = document.getElementById("enable-proxy");
    const preferHttps = document.getElementById("prefer-https").checked;
    const useSocks5 = document.getElementById("use-socks5").checked;
    
    if (proxyInput) {
        const parts = proxyInput.split(':');
        
        if (useSocks5 && parts.length !== 2) {
            showStatus('SOCKS5 proxy must be in IP:PORT format only', 'error', 500);
            return;
        }
        
        if (!useSocks5 && parts.length !== 2 && parts.length !== 4) {
            showStatus('Proxy must be in IP:PORT or IP:PORT:USERNAME:PASSWORD format', 'error', 500);
            return;
        }

        chrome.storage.sync.set({ 
            proxyDetails: proxyInput,
            proxyEnabled: true,
            preferHttps: preferHttps,
            useSocks5: useSocks5
        }, () => {
            enableProxy.checked = true;
            addProxyToHistory(proxyInput);
            showStatus('Proxy settings applied - waiting for connection check...', 'success', 500);
        });
    } else {
        showStatus('Please enter proxy details', 'error', 500);
    }
});

document.getElementById("clear-button").addEventListener("click", () => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false,
        lastKnownIP: null,
        lastProxyStatus: null,  // Clear stored status
        lastProxyError: null    // Clear stored errors
    });
    document.getElementById("proxy-input").value = '';
    document.getElementById("enable-proxy").checked = false;
    showStatus('Proxy settings cleared', 'success', 500);
});

document.getElementById("clear-history-button").addEventListener("click", () => {
    chrome.storage.sync.set({ proxyHistory: [] }, () => {
        displayHistory([]);
        showStatus('History cleared', 'success', 500);
    });
});

function addProxyToHistory(proxyEntry) {
    chrome.storage.sync.get("proxyHistory", (data) => {
        let history = data.proxyHistory || [];
        if (!history.includes(proxyEntry)) {
            history.unshift(proxyEntry);
            if (history.length > 10) history.pop();
            chrome.storage.sync.set({ proxyHistory: history }, () => {
                displayHistory(history);
            });
        }
    });
}

function displayHistory(history) {
    const historyList = document.getElementById("history-list");
    historyList.innerHTML = "";
    
    history.forEach((proxy) => {
        const item = document.createElement("div");
        item.textContent = proxy;
        item.className = "history-item";
        
        item.addEventListener("dblclick", () => {
            document.getElementById("proxy-input").value = proxy;
            chrome.storage.sync.set({ 
                proxyDetails: proxy,
                proxyEnabled: true
            });
            document.getElementById("enable-proxy").checked = true;
            showStatus('Proxy settings applied from history - waiting for connection check...', 'success', 500);
        });
        
        historyList.appendChild(item);
    });
}

function showStatus(message, type, duration = 500) {
    const statusIndicator = document.getElementById("status-indicator");
    if (statusIndicator) {
        statusIndicator.innerHTML = message.replace(/\n/g, '<br>');
        statusIndicator.className = type;
        statusIndicator.style.display = "block";
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'proxyError') {
        showStatus(message.message, 'error', 500);
    }
    if (message.type === 'proxyStatus') {
        const statusMsg = message.matched === true ? 
            `Proxy Status\nIP: ${message.ip}\nStatus: Verified` :
            message.matched === false ?
            `Proxy Status\nIP: ${message.ip}\nStatus: Warning - IP Mismatch` :
            `Proxy Status\nIP: ${message.ip}\nStatus: Active`;
        
        showStatus(statusMsg, message.matched === false ? 'warning' : 'success', 500);
    }
});