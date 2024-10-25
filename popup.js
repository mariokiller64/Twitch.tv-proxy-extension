document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
});

function loadSettings() {
    chrome.storage.sync.get(
        ["proxyDetails", "proxyHistory", "proxyEnabled", "preferHttps"], 
        (data) => {
            document.getElementById("proxy-input").value = data.proxyDetails || '';
            document.getElementById("enable-proxy").checked = !!data.proxyEnabled;
            document.getElementById("prefer-https").checked = 
                data.preferHttps !== undefined ? data.preferHttps : true;
            displayHistory(data.proxyHistory || []);
        }
    );
}

document.getElementById("enable-proxy").addEventListener("change", (e) => {
    chrome.storage.sync.set({ proxyEnabled: e.target.checked });
});

document.getElementById("prefer-https").addEventListener("change", (e) => {
    chrome.storage.sync.set({ preferHttps: e.target.checked });
});

document.getElementById("apply-button").addEventListener("click", () => {
    const proxyInput = document.getElementById("proxy-input").value;
    const enableProxy = document.getElementById("enable-proxy");
    const preferHttps = document.getElementById("prefer-https").checked;
    
    if (proxyInput) {
        chrome.storage.sync.set({ 
            proxyDetails: proxyInput,
            proxyEnabled: true,
            preferHttps: preferHttps
        }, () => {
            enableProxy.checked = true;
            addProxyToHistory(proxyInput);
            showStatus('Proxy settings applied successfully', 'success');
        });
    } else {
        showStatus('Please enter proxy details in IP:PORT:USERNAME:PASSWORD format', 'error');
    }
});

document.getElementById("clear-button").addEventListener("click", () => {
    chrome.storage.sync.set({ 
        proxyDetails: null,
        proxyEnabled: false
    });
    document.getElementById("proxy-input").value = '';
    document.getElementById("enable-proxy").checked = false;
    showStatus('Proxy settings cleared', 'success');
});

document.getElementById("clear-history-button").addEventListener("click", () => {
    chrome.storage.sync.set({ proxyHistory: [] }, () => {
        displayHistory([]);
        showStatus('History cleared', 'success');
    });
});

function addProxyToHistory(proxyEntry) {
    chrome.storage.sync.get("proxyHistory", (data) => {
        let history = data.proxyHistory || [];
        if (!history.includes(proxyEntry)) {
            history.unshift(proxyEntry);
            if (history.length > 10) history.pop();
            chrome.storage.sync.set({ proxyHistory: history });
        }
        displayHistory(history);
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
            showStatus('Proxy settings applied from history', 'success');
        });
        
        historyList.appendChild(item);
    });
}

function showStatus(message, type) {
    const statusIndicator = document.getElementById("status-indicator");
    if (statusIndicator) {
        statusIndicator.textContent = message;
        statusIndicator.className = type;
        statusIndicator.style.display = "block";
        
        setTimeout(() => {
            statusIndicator.style.display = "none";
        }, 3000);
    }
}

// Listen for errors from background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'proxyError') {
        showStatus(message.message, 'error');
    }
});