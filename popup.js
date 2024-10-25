document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    initializeSpeedTest();
});

function loadSettings() {
    chrome.storage.sync.get(
        ["proxyDetails", "proxyHistory", "proxyEnabled", "preferHttps", "useSocks5", "lastHealthCheck", "lastKnownIP"], 
        (data) => {
            document.getElementById("proxy-input").value = data.proxyDetails || '';
            document.getElementById("enable-proxy").checked = !!data.proxyEnabled;
            document.getElementById("prefer-https").checked = 
                data.preferHttps !== undefined ? data.preferHttps : true;
            document.getElementById("use-socks5").checked = !!data.useSocks5;
            displayHistory(data.proxyHistory || []);
            updateInputPlaceholder();
            if (data.lastHealthCheck && data.lastKnownIP) {
                updateProxyStatus(data.lastHealthCheck, data.lastKnownIP);
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
            
            // Test Twitch connection
            const response = await fetch('https://api.twitch.tv/helix', {
                method: 'HEAD'
            });
            const endTime = Date.now();
            const latency = endTime - startTime;
            
            showStatus(
                `Speed Test Results\nConnection: ${proxyStatus}\nIP: ${ipData.ip}\nLatency: ${latency}ms`, 
                latency < 200 ? 'success' : 'warning',
                15000
            );
        });
    } catch (error) {
        showStatus('Speed test failed - Check connection', 'error', 15000);
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
            showStatus('SOCKS5 proxy must be in IP:PORT format only', 'error', 5000);
            return;
        }
        
        if (!useSocks5 && parts.length !== 2 && parts.length !== 4) {
            showStatus('Proxy must be in IP:PORT or IP:PORT:USERNAME:PASSWORD format', 'error', 5000);
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
            showStatus('Proxy settings applied - waiting for connection check...', 'success', 5000);
        });
    } else {
        showStatus('Please enter proxy details', 'error', 5000);
    }
});

document.getElementById("clear-button").addEventListener("click", () => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false,
        lastKnownIP: null
    });
    document.getElementById("proxy-input").value = '';
    document.getElementById("enable-proxy").checked = false;
    showStatus('Proxy settings cleared', 'success', 5000);
});

document.getElementById("clear-history-button").addEventListener("click", () => {
    chrome.storage.sync.set({ proxyHistory: [] }, () => {
        displayHistory([]);
        showStatus('History cleared', 'success', 5000);
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
            showStatus('Proxy settings applied from history - waiting for connection check...', 'success', 5000);
        });
        
        historyList.appendChild(item);
    });
}

function showStatus(message, type, duration = 5000) {
    const statusIndicator = document.getElementById("status-indicator");
    if (statusIndicator) {
        statusIndicator.innerHTML = message.replace(/\n/g, '<br>');
        statusIndicator.className = type;
        statusIndicator.style.display = "block";
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'proxyError') {
        showStatus(message.message, 'error', 10000);
    }
    if (message.type === 'proxyStatus') {
        const statusMsg = message.matched === true ? 
            `Proxy Status\nIP: ${message.ip}\nStatus: Verified` :
            message.matched === false ?
            `Proxy Status\nIP: ${message.ip}\nStatus: Warning - IP Mismatch` :
            `Proxy Status\nIP: ${message.ip}\nStatus: Active`;
        
        showStatus(statusMsg, message.matched === false ? 'warning' : 'success', 15000);
    }
});