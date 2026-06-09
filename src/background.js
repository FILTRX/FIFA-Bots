'use strict';
// Relay messages between content script and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOG' || msg.type === 'STATE_UPDATE') {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
  sendResponse({ ok: true });
  return true;
});
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {});
