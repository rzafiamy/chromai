// Open side panel when toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Enable side panel on all URLs
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: true });
});

// Relay tab activation so the sidebar can refresh its page context
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.runtime.sendMessage({ action: 'TAB_CHANGED', tabId }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    chrome.runtime.sendMessage({ action: 'TAB_CHANGED', tabId }).catch(() => {});
  }
});
